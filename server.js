import pino from 'pino'
import fs from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import express, { json } from 'express'
import session from 'express-session'
import MySQLSession from 'express-mysql-session'
import slashes from 'connect-slashes'
import compression from 'compression'
import bodyParser from 'body-parser'
import multer from 'multer'
import { confLogger, confQubic, confServer, confUsers } from "./config.js"
import { dbConnect, dbCreateUser, dbVerifyUser, minutesToDays } from "./functions.js"


process.env.TZ = "UTC"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const logger = pino(pino.destination({
    dest: './logs/serve.log',
    level: confLogger.level,
}))
const app = express()
const upload = multer()
//const cookie = cookieParser(confServer.sessionSecretKey)
//app.set("strict routing", true)
app.set('view engine', 'pug')
app.set('views','./src/views/')
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));
app.use(upload.array())
//app.use(cookie)

function shouldCompress (req, res) {
    if (req.headers['x-no-compression']) {
      // don't compress responses with this request header
      return false
    }
    return compression.filter(req, res)
  }
app.use(compression({ filter: shouldCompress }))

// Once every 4 hours
function touchSession(req, res, next) {
    if (req.session.time) {
        const ts = new Date().getTime()
        if ((ts - req.session.time) > 14400000) {
            req.session.time = ts
        }
    }
    //next()
}
const dbcSession = dbConnect()
const sessionStore = new (MySQLSession(session))({}, dbcSession)
app.use(session({
	store: sessionStore,
    secret: confServer.sessionSecretKey,
    resave: false,
    saveUninitialized: false,
    cookie: {
        expires: 86400000 // Session expires after 1 day
    }
}))
app.use(express.static(__dirname + '/dist'))
app.use(slashes())


function checkAuth(req, res, next) {
    if (req.session.userId) {
        touchSession(req, res, next)
        next()
    }
    else {
        res.redirect('/login/')
    }
}
function nocache(req, res, next) {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate')
    res.header('Expires', '-1')
    res.header('Pragma', 'no-cache')
    next()
}

app.get('/', function(req, res, next) {
    res.render('index.pug', { url: req.url })
    //next(new Error('Example error message'))
})
app.get('/login/', (req, res) => {
    if (req.session.userId) res.redirect('/panel/')
    else res.render('login.pug', { url: req.url })
})
app.post('/login/', nocache, async (req, res) => {
    if (req.session.userId) {
        res.json({success: 0, message: "You are already authorized"})
        return
    }
    if(req.body.login && req.body.password){
        let dbc
        try {
            dbc = await dbConnect()
            const user = req.body.login.trim()
            const userId = await dbVerifyUser(dbc, req.body.login, req.body.password)
            if(userId){
                req.session.user = user
                req.session.userId = userId
                req.session.time = new Date().getTime()
                res.json({success: '/panel/', message: ""})
                return
            }
        } catch(err) {
            logger.error({url: req.url}, err.message)
            res.json({success: 0, message: "Server is temporarily unavailable"})
            return
        } finally {
            if (dbc) dbc.end()
        }
    }
    res.json({success: 0, message: "Invalid login or password!"})
})

app.get('/register/', function(req, res){
    if (req.session.userId) res.redirect('/panel/')
    else res.render('register.pug')
})
app.post('/register/', nocache, async function(req, res){
    if (req.session.userId) {
        res.json({success: 0, message: "You are already authorized"})
        return
    }
    if(req.body.login && req.body.email && req.body.password && req.body.password2 && req.body.wallet && req.body.code){
        let dbc
        try {
            if (req.body.code != confServer.inviteCode) {
                res.json({success: 0, message: "Invalid invitation code", fieldsError: ['code']})
                return
            }
            if (req.body.login.length < 5 && !req.body.login.match(/^[a-zA-Z\d]+$/)) {
                res.json({success: 0, message: "The minimum length is 5 and characters are allowed 0-9A-Za-z", fieldsError: ['login']})
                return
            }
            if (req.body.login.password < 8) {
                res.json({success: 0, message: "The minimum length is 8", fieldsError: ['password']})
                return
            }
            if (req.body.password !== req.body.password2) {
                res.json({success: 0, message: "Repeat passwords must be the same", fieldsError: ['password2']})
                return
            }
            if (req.body.wallet.length != 60) {
                res.json({success: 0, message: "Wallet length must be 60", fieldsError: ['wallet']})
                return
            }
            const login = req.body.login.toLowerCase()
            dbc = await dbConnect()
            const [rowsUser] = await dbc.query({sql: 'SELECT id FROM users WHERE login = ?', rowsAsArray: true}, [login])
            if (rowsUser.length) {
                res.json({success: 0, message: "There is already a user with this login", fieldsError: ['login']})
                return
            }
            const [rowsEmails] = await dbc.query({sql: 'SELECT id FROM users WHERE email = ?', rowsAsArray: true}, [req.body.email])
            if (rowsEmails.length) {
                res.json({success: 0, message: "There is already a user with this email", fieldsError: ['email']})
                return
            }
            const [newuser] =  await dbCreateUser(dbc, login, req.body.email, req.body.password, req.body.wallet)
            if (newuser && newuser.insertId) {
                req.session.user = login
                req.session.userId = newuser.insertId
                req.session.time = new Date().getTime()
                res.json({success: '/panel/', message: ""})
                return
            } else {
                logger.error({newuser}, 'Failed to create user. Server has a problem')
                res.json({success: 0, message: "Failed to create user. Server has a problem"})
                return
            }
        } catch(err) {
            logger.error({err, url: req.url})
            res.json({success: 0, message: "Server is temporarily unavailable"})
            return
        } finally {
            if (dbc) dbc.end()
        }
    }
    res.json({success: 0, message: "There are empty fields!"})
})
app.get('/logout/', function(req, res){
    req.session.destroy()
    res.redirect('/')
 })

 
app.get('/panel/', checkAuth, function(req, res){
    res.render('dashboard.pug')
})
app.get('/panel/stats/', nocache, checkAuth, function(req, res){
    let users = [] // [login, avg hashrate, procent]
    let workers = [] // [alias, avg hashrate, procent activity, start activity, last activity, active minutes, Accounting]
    try {
        let data  = fs.readFileSync(__dirname + '/data/calc-stats.json', 'utf8')
        data = JSON.parse(data)
        if (data.users) {
            const fnPushUser = (user, enableMask = true, highlight = false) => {
                if (enableMask) user.login = user.login.slice(0, 3) + '******'
                users.push([
                    user.login,
                    user.statistics[0],
                    user.statistics[1],
                    user.revenue.solulions,
                    user.revenue.potencialSols,
                    user.revenue.potencialUSD,
                    highlight
                ])
            }
            if (confUsers.admins.indexOf(req.session.userId) !== -1) { //admin. Print all info
                for (var key in data.users) {
                    if (data.users.hasOwnProperty(key)) {
                        fnPushUser(data.users[key], false)
                        data.users[key].workers.forEach(worker => {
                            worker[0] = data.users[key].login + '.' + worker[0]
                            workers.push(worker)
                        })
                    }
                }
                
                users.sort((a, b) => (a[0] > b[0] ? 1 : -1))
                workers.sort((a, b) => (a[0] > b[0] ? 1 : -1))
            } else if (data.users[req.session.userId]) {
                data.users[req.session.userId].workers.forEach(worker => {
                    worker[0] = data.users[req.session.userId].login + '.' + worker[0]
                    workers.push(worker)
                })
                fnPushUser(data.users[req.session.userId], false, true)
                for (var key in data.users) {
                    if (data.users.hasOwnProperty(key) && key != req.session.userId) {
                        fnPushUser(data.users[key], true)
                    }
                }
            }
        }
    } catch(err) {
        logger.error({err})
    }
    res.render('stats.pug', {workers, users})
})
app.get('/panel/profile/', checkAuth, async function(req, res, next){
    let dbc
    try {
        dbc = await dbConnect()
        const [rows] = await dbc.query({sql: 'SELECT login, email, wallet FROM users WHERE id = ?'}, [req.session.userId])
        res.render('profile.pug', rows[0])
    } catch(err) {
        next(err)
    } finally {
        if (dbc) {
            dbc.end()
        }
    }
})
app.get('/panel/about/', checkAuth, function(req, res){
    res.render('about.pug')
})
app.get('/panel/instruction/', checkAuth, function(req, res){
    res.render('instruction.pug')
})

//api
app.get('/api/receive/', nocache, checkAuth, async function(req, res){ // only current user
    res.setHeader('x-no-compression', '1')
    let json = []
    try {
        let data  = fs.readFileSync(__dirname + '/data/receive.json')
        data = JSON.parse(data)
        //console.log([confUsers.admins, req.session.userId])
        if (confUsers.admins.indexOf(req.session.userId) !== -1) { //admin. Print all info
            json = data
        } else {
            for(const item of data) {
                const regex = new RegExp('^' + req.session.user + '(\.|___)', 'i')
                if (item.alias.match(regex)) {
                    json.push(item)
                }
            }
        }
    } catch(err) {
        logger.error({err})
    }
    res.json(json)
})
app.get('/api/maininfo/', nocache, (req, res) => {
    res.setHeader('x-no-compression', '1')
    res.header("Content-Type",'application/json')
    res.sendFile(__dirname + '/data/maininfo.json')
})
app.get('/api/miners/', nocache, (req, res) => {
    res.setHeader('x-no-compression', '1')
    res.header("Content-Type",'application/json')
    if (req.session.userId) {
        res.sendFile(__dirname + '/data/miners.json')
    } else {
        res.sendFile(__dirname + '/data/miners-public.json')
    }
})
app.get('/api/solutions/', nocache, (req, res) => {
    res.setHeader('x-no-compression', '1')
    res.header("Content-Type",'application/json')
    res.sendFile(__dirname + '/data/solutions.json')
})


//Handling 404
app.use((req, res, next) => {
    res.status(404)
    if (req.accepts('html')) {
        res.render('404.pug')
    } else if (req.accepts('json')) {
        res.json({ error: 'Not found' })
    } else {
        res.type('txt').send('Not found')
    }
})

// Handling 500
app.use(function(error, req, res, next) {
    logger.error({url: req.url}, error.message)
    res.status(500).render('500.pug');
})
app.listen(confServer.port, function () {
    console.log(`Server listens http://127.0.0.1:${confServer.port}`);
})