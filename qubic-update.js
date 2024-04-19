import pino from 'pino'
import fs from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { confEpoch, confLogger, confQubic } from "./config.js"
import { dbConnect, getPrice } from "./functions.js"

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
        // savedata
        fs.writeFile(__dirname + '/data/receive.json', JSON.stringify(serverData), err => { 
            if(err) throw err
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
                totalSolutions += item.sol
                if (item.isActive) {
                    totalHashrate += item.its
                    ++totalActiveWorkers
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
    
        try {
            dbc.end()
            dbc = null
        } catch(err) { 
            log.warning('DB end error: ' + err.message)
        }


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
        response = await fetch('https://api.qubic.li/Score/Get', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'User-Agent': userAgent
            },
            timeout: 10000,
        })
        serverData = await response.json()
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
                        solutions: totalSolutions,
                        hashrate: totalHashrate,
                        activeWorkers: totalActiveWorkers
                    }
                }),
                err => { 
                    if(err) throw err
                }
            )

            /**
                print(f'Current epoch: {make_light_blue(f"{currentEpochNumber}")}')
                print(f'Epoch start UTC: {make_light_yellow(f"{epochBegin}")}')
                print(f'Epoch end UTC: {make_light_yellow(f"{epochEnd}")}')
                print(f'Epoch progress: {make_light_yellow(f"{100 * progress:.1f}%")}\n')
                print('Network Info')
                print(f'Estimated network hashrate: {make_light_blue(f"{netHashrate:,} it/s")}')
                print(f'Average score: {make_light_yellow(f"{netAvgScores:.1f}")}')
                print(f'Scores per hour: {make_light_yellow(f"{netSolsPerHour:.1f}")}\n')
                print('Income Estimations')
                print(f'Qubic price: {make_light_yellow(f"{qubic_price:.8f}$")}\n')
                print(f'Estimated income per 1 it/s per day: {make_light_green(f"{incomePerOneIts:.4f}$")}')
                print(f'Estimated income per day: {make_light_green(f"{myHashrate * incomePerOneIts:.2f}$")}')
                print(f'Estimated income per 1 sol: {make_light_green(f"{curSolPrice:.2f}$")}')
                print(f'Estimated sols per day: {make_light_green(f"{24 * myHashrate * netSolsPerHour / netnetHashrate_hashrate:.1f}")}\n')
             */
        }
    } else {
        logger.warning('Error: not miners data from server')
    }
} catch (err) {
    logger.error(err)
    if (dbc) {
        dbc.end()
    }
}

