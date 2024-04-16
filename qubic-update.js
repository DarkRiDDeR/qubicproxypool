
import pino from 'pino'
import { confLogger, confQubic } from "./config.js"
import { dbConnect } from "./functions.js"

process.env.TZ = "UTC"

const logger = pino(pino.destination({
    //dest: './logs/qubic-updater.log',
    level: confLogger.level,
}))

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
const timeout = 30000
let serverData = ''
let response, result, token
let dbc


try {
    if (confQubic.specificDataServer) {
        response  = await fetch(confQubic.specificDataServer, {
            headers: {
                'User-Agent': userAgent
            },
            timeout: timeout
        })
        serverData = await response.json()
    } else {
        let postData = JSON.stringify({ 'userName': confQubic.login, 'password': confQubic.password, 'twoFactorCode': '' })
        response  = await fetch('https://api.qubic.li/Auth/Login', {
            method: 'POST',
            body: postData,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': userAgent
            },
            timeout: timeout
        })

        result = await response.json()
        token = result.token

        if (!token) {
            logger.error(result, 'Error token')
        } else {

            /*
            miners: [
                {
                id: '1dfff512-a17a-4e6a-8489-2e3640303bb4',
                minerBinaryId: null,
                alias: 'admin.2680',
                version:{"major":1,"minor":8,"patch":10,"versionString":"1.8.10"},
                outdatedVersion: false,
                lastActive: '2024-03-18T09:05:59.37',
                currentIts: 132,
                currentIdentity: 'OZLVNWQIXWVDYBSRZNIFARWFJDXAUTJSSWRXLWSQYEIGOXVZSSYTILNAXHQJ',
                solutionsFound: 0,
                threads: null,
                totalFeeTime: 0,
                feeReports: [],
                isActive: true
                }
            ],
            */
            response  = await fetch('https://api.qubic.li/My/MinerControl', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': userAgent
                },
                timeout: timeout,
            })
            serverData = await response.json()
            serverData = serverData.miners
        }
    }


    if (serverData) {
        try {
            dbc = await dbConnect()
        } catch(err) { 
            logger.error('DB connection error: ' + err.message)
            process.exit(1)
        }

        const dbUsers = new Map()  // [login, id]
        let dbWorkers = new Map()// [user_id.name, id]
        let rows
        [rows] = await dbc.query({sql: 'SELECT login, id FROM users', rowsAsArray: true})
        rows.reduce((map, row) => {
            map.set(row[0], row[1])
            return map
        }, dbUsers)
        //console.log(dbUsers)
        
        const [rowsWorkers] = await dbc.query({sql: 'SELECT user_id, name, id FROM workers', rowsAsArray: true})
        rowsWorkers.reduce((map, row) => {
            map.set(`${row[0]}.${row[1]}`, row[2])
            return map
        }, dbWorkers)

        let stats = new Map() // [user.worker, [user, worker, its, sol, lastActive, isActive, version]]
        //let poolUsers = new Set() 
        let poolWorkers = new Map() // [user.worker, [user, worker]]
        for(let item of serverData) {
            let alias = item.alias.trim().toLowerCase().split(/(\.|___)/, 3)
            let worker = alias[0].trim()
            let user = 'none' // no detect user
            if (alias.length > 1) {
                user = worker
                worker  = alias[2].trim()
            }
            if (!dbUsers.has(user)) {
                user = 'none'
            }

            // none and test user not save
            if (user.match(/^(none|test)/)) {
                continue
            }

            const userWorker = user + '.' + worker
            const its = parseInt(item.currentIts) 
            const sol = parseInt(item.solutionsFound)
            const lastActive = item.lastActive
            const isActive = item.isActive ? 1 : 0
            const version = item.version.versionString

            //poolUsers.add(user)
            poolWorkers.set(userWorker, [user, worker])

            if (stats.has(userWorker)) { // repeat user.worker
                let statItem = stats.get(userWorker)
                if (isActive && statItem.its > 0) { // active and prev item = 0 it/s 
                    statItem.sol += sol
                    statItem.its += its
                    stats.set(userWorker, statItem)
                }
            } else {
                stats.set(userWorker, { user, worker, its, sol, lastActive, isActive, version})
            }
        }
        //console.log(dbUsers)
        //console.log(dbWorkers)
        //console.log(poolWorkers)
        //console.log(stats)

        let newWorkers = [...poolWorkers.values()].filter(item => {
            return !dbWorkers.has(dbUsers.get(item[0]) + '.' + item[1])
        })
        //newWorkers.push(['jhon', '2680dual'])
        console.log(newWorkers)
        let firstItem
        if (newWorkers && (firstItem = newWorkers.shift())) {
            let sql = `INSERT INTO workers(user_id, name) VALUES ( ${dbUsers.get(firstItem[0])}, ${dbc.escape(firstItem[1])} )`
            while(firstItem = newWorkers.shift()) {
                sql += `, ( ${dbUsers.get(firstItem[0])}, ${dbc.escape(firstItem[1])} )`
            }
            sql += ';'
            await dbc.query(sql)

            
            dbWorkers = new Map()
            const [rowsWorkers2] = await dbc.query({sql: 'SELECT user_id, name, id FROM workers', rowsAsArray: true})
            rowsWorkers2.reduce((map, row) => {
                map.set(row[0] + '.' + row[1], row[2])
                return map
            }, dbWorkers)
        }

        if (stats) {
            let sql = ''
            stats.forEach(item => {
                const userId = dbUsers.get(item.user)
                const workerId = dbWorkers.get(userId + '.' + item.worker)
                if (sql) {
                    sql += ', '
                }
                sql += `(${userId}, ${workerId}, '${item.version}', '${item.its}', '${item.sol}', '${item.isActive}', '${item.lastActive}')`
            })
            sql = 'INSERT INTO workers_statistics(user_id, worker_id, version, hashrate, solutions, is_active, last_active) VALUES ' + sql + ';'
            //console.log(sql)
            await dbc.query(sql)
        }
    
        try {
            dbc.end()
        } catch(err) { 
            log.warning('DB end error: ' + err.message)
        }
    } else {
        logger.warning(serverData, 'Error: not miners data')
    } 
} catch (err) {
    logger.error(err)
    dbc.end()
}

