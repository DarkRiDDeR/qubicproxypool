import pino from 'pino'
import fs from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import moment from 'moment'
import twoFactor from 'node-2fa'
import { confEpoch, confLogger, confQubic } from "./config.js"
import { dbConnect, getPrice, getEpochStartTimestamp, getSolsStatistics } from "./functions.js"

process.env.TZ = "UTC"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)


const logger = pino(pino.destination({
    dest: './logs/qubic-updater.log',
    level: confLogger.level,
}))

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
const timeout = 30000
let serverData = ''
let serverToken, serverUserId
let response, result
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
        /**
         {
            success: true,
            token: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJJZCI6ImExMmj4',
            refreshToken: 'KLHRA0so746tiygNrhxRHHTM3H4xA/4WbI3',
            user: {
                id: 'a12ef9e9-3116-4aca-b55e-1d641',
                name: 'darkridderr@ya.ru',
                avatar: null,
                status: 'online',
                privileges: [],
                is2FAEnabled: false
            }
            }
         */
        let twoFactorCode = ''
        if (confQubic.token2fa) {
            await new Promise(resolve => setTimeout(resolve, 5000))
            twoFactorCode = twoFactor.generateToken(confQubic.token2fa)
        }
        let postData = JSON.stringify({ 'userName': confQubic.login, 'password': confQubic.password, 'twoFactorCode': twoFactorCode.token })
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
        serverToken = result.token
        serverUserId = result.user.id

        if (!serverToken) {
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
           /**
            * let Ke=`/My/Pool/${this.configuration.encodeParam({name:"id",value:de,in:"path",style:"simple",explode:!1,dataType:"string",dataFormat:"uuid"})}/Performanc
            * https://api.qubic.li/My/Pool/c3b45fea-e748-428f-96fe-222d722682b8/Performance
            * https://api.qubic.li/My/MinerControl
            */
            response  = await fetch(`https://api.qubic.li/My/MinerControl`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serverToken}`,
                    'User-Agent': userAgent
                },
                timeout: timeout,
            })
            serverData = await response.json()
        }
    }


    if (serverData.miners) {
        // savedata
        serverData = serverData.miners
        serverData.sort((a, b) => {
            return a.alias.toLowerCase() > b.alias.toLowerCase() ? 1 : -1 
        })
        fs.writeFile(__dirname + '/data/receive.json', JSON.stringify(serverData), err => { 
            if(err) logger.error({err})
        })

        try {
            dbc = await dbConnect()
        } catch(err) { 
            logger.error('DB connection error: ' + err.message)
            process.exit(1)
        }

        let totalHashrate = 0
        let totalSolutions = 0
        let totalActiveWorkers = 0
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

        let stats = new Map() // [user.worker, {user, worker, its, sol, lastActive, isActive, version}]
        let miners = new Map() // current miners stats [user, {countWorker, its, sol, countInactive, isEmpty}] isEmpty - there are workers with zero hashrate or inactive
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

            // none user not save
            if (user == 'none') {
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
                if (!statItem.isActive) { // overwrite the previous inactive one
                    sol += statItem.sol
                    stats.set(userWorker, { user, worker, its, sol, lastActive, isActive, version})
                } else if (isActive && statItem.its == 0) { // active and prev item = 0 it/s. Hashrete of repeating ones cannot be summed up
                    statItem.sol += sol
                    statItem.its = its
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
        //console.log(newWorkers)
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

        //console.log(stats)
        if (stats) {
            let sql = ''
            stats.forEach(item => {
                let its = 0
                totalSolutions += item.sol
                if (item.isActive) {
                    its = item.its
                    totalHashrate += its
                    ++totalActiveWorkers
                }

                if (miners.has(item.user)) {
                    const minerItem = miners.get(item.user)
                    minerItem.its += its
                    minerItem.sol += item.sol
                    ++minerItem.countWorker
                    minerItem.isEmpty = minerItem.its ? 0 : 1
                    if (!item.isActive) ++minerItem.countInactive
                    miners.set(item.user, minerItem)
                } else {
                    miners.set(item.user, {countWorker: 1, its: its, sol: item.sol, countInactive: item.isActive ? 0 : 1, isEmpty: its ? 0 : 1})
                }

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
    
        // save miner stats
        miners = Array.from(miners, ([name, item]) => {
            item.miner = name
            return item
        })
        miners.sort((a, b) => {
            return a.miner > b.miner ? 1 : -1 
        })
        fs.writeFile(__dirname + '/data/miners.json', JSON.stringify(miners), err => { 
            if(err) logger.error({err})
        })
        if (miners.length > 10) {
            miners.length = 10
        }
        miners.map(item => {
            item.countInactive = null
            item.isEmpty = null
            item.miner = item.miner.slice(0, 3) + '******'
            return item
        })
        miners.sort((a, b) => {
            return b.its - a.its
        })
        fs.writeFile(__dirname + '/data/miners-public.json', JSON.stringify(miners), err => { 
            if(err) logger.error({err})
        })

        // qubic price
        let price = 0
        try {
            price = await getPrice(5000)
            fs.writeFile(__dirname + '/data/price.txt', price.toString(), err => { 
                if(err) throw err
            })
        } catch(err) {
            logger.warn(err, 'price processing error')
        }
        if (!price) {
            try {
                if (fs.existsSync(__dirname + '/data/price.txt')) {
                    price = parseFloat(fs.readFileSync(__dirname + '/data/price.txt', 'utf-8'))
                }
            } catch(err) {
                logger.warn(err, 'price processing 2 error')
            }
        }
        

        //Fetches and returns network statistics
        serverData = ''
        let responsePerformance = ''
        try {
            responsePerformance = await fetch(`https://api.qubic.li/My/Pool/${serverUserId}/Performance`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serverToken}`,
                    'User-Agent': userAgent
                },
                timeout: timeout,
            })
            responsePerformance = await responsePerformance.json()

            response = await fetch('https://api.qubic.li/Score/Get', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serverToken}`,
                    'User-Agent': userAgent
                },
                timeout: 10000,
            })
            serverData = await response.json()
        } catch(err) {
            logger.warn({err})
            serverData = ''
        }

        const currentSols = parseInt(responsePerformance.foundSolutions)
        if (serverData) {
            const now = new Date().getTime()
            const millisecondsInWweek = 604800000
            const currentEpochNumber = serverData['scoreStatistics'][0]['epoch']
            const epoch103Begin = confEpoch.timestamp
            const epochBegin = epoch103Begin + millisecondsInWweek * (currentEpochNumber - confEpoch.number)
            const epochEnd = epochBegin + millisecondsInWweek - 1000
            const progress = (now - epochBegin) / 604800000
            const netHashrate = serverData['estimatedIts']
            const netAvgScores = serverData['averageScore']
            const netSolsPerHour = serverData['solutionsPerHour']
            const poolReward = 0.85
            const incomePerOneIts = poolReward * price * 1000000000000 / netHashrate / 7 / 1.06
            const curSolPrice = 1479289940 * poolReward * progress * price / (netAvgScores * 1.06)
            fs.writeFile(__dirname + '/data/maininfo.json', JSON.stringify({
                    updateTime: now,
                    price,
                    epoch: currentEpochNumber,
                    epochBegin,
                    epochEnd,
                    progress,
                    netHashrate,
                    netAvgScores,
                    netSolsPerHour,
                    incomePerOneIts,
                    curSolPrice,
                    total: {
                        solutions: currentSols, //totalSolutions,
                        hashrate: totalHashrate,
                        activeWorkers: totalActiveWorkers
                    }
                }),
                err => { 
                    if(err) throw err
                }
            )
        }

        // insert solutions
        if (currentSols > 0) {
            try {
                const [rowsSolutions] = await dbc.query(
                    {sql: 'SELECT number FROM `solutions` WHERE time > ? ORDER BY `id` DESC LIMIT 1', rowsAsArray: true},
                    [moment.unix(getEpochStartTimestamp()).format('YYYY-MM-D HH:mm:ss')]
                )
                if (rowsSolutions.length && currentSols > rowsSolutions[0][0]) {
                    await dbc.query('INSERT INTO solutions(number) VALUES (?);', [currentSols])
                }
            } catch (err) {
                logger.warn({err})
            }
        }

        // solutions
        try {
            let dataSols = await getSolsStatistics(dbc, 7200)
            fs.writeFile(__dirname + '/data/solutions.json', JSON.stringify(Object.fromEntries(dataSols)), err => { 
                if(err) throw err
            })
        } catch (err) {
            logger.warn({err})
        }
        
        dbc.end()
        dbc = null
    } else {
        logger.warning('Error: not miners data from server')
    }
} catch (err) {
    logger.error({err})
    if (dbc && dbc.end) {
        dbc.end()
    }
}

