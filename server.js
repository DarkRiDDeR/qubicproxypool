import pino from 'pino'
import fs from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import express from 'express'
import session from 'express-session'
import slashes from 'connect-slashes'
import bodyParser from 'body-parser'
import multer from 'multer'
import { confLogger, confQubic, confServer, confUsers } from "./config.js"
import { dbConnect, dbVerifyUser } from "./functions.js"


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
const sessionConf = {
    secret: confServer.sessionSecretKey,
    resave: true,
    saveUninitialized: true,
    cookie: {
        expires: 86400000 // Session expires after 1 day
    }
}
app.use(session(sessionConf))
app.use(express.static(__dirname + '/dist'))
app.use(slashes())

function checkAuth(req, res, next) {
    //req.session.userId = 2
    //req.session.user = 'admin'
    if (req.session.userId) next()
    else res.redirect('/login/')
}

app.get('/', function(req, res, next) {
    res.render('index.pug', { url: req.url })
    //next(new Error('Example error message'))
})
app.get('/login/', (req, res) => {
    res.render('login.pug', { url: req.url })
})
app.post('/login/', async (req, res) => {
    if(req.body.login && req.body.password){
        let dbc
        try {
            dbc = await dbConnect()
            const user = req.body.login.trim()
            const userId = await dbVerifyUser(dbc, req.body.login, req.body.password)
            if(userId){
                req.session.user = user
                req.session.userId = userId
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
    res.render('register.pug')
})
app.post('/register/', async function(req, res){
    if(req.body.login && req.body.email && req.body.password && req.body.password2 && req.body.wallet){
        let dbc
        try {
            dbc = await dbConnect()
            
            

        } catch(err) {
            logger.error({url: req.url}, err.message)
            res.json({success: 0, message: "Server is temporarily unavailable"})
            return
        } finally {
            if (dbc) dbc.end()
        }
    }
    res.json({success: 0, message: "Еhere are empty fields!"})
})
app.get('/logout/', function(req, res){
    req.session.destroy()
    res.redirect('/')
 })

 
app.get('/panel/', checkAuth, function(req, res){
    res.render('dashboard.pug')
})
app.get('/panel/calc/', checkAuth, function(req, res){
    res.render('calc.pug')
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
app.get('/api/receive/', checkAuth, async function(req, res){ // only current user
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
        logger.error(err)
    }
    res.json(json)
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