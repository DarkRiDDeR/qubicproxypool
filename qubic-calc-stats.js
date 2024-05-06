import pino from 'pino'
import fs from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import mysql from 'mysql2/promise'
import { confLogger, confDb, confQubic } from "./config.js"
import { calculateStatistics, minutesToDays, getPrice } from "./functions.js"

process.env.TZ = "UTC"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const logger = pino(pino.destination({
    dest: './logs/qubic-calc-stats.log',
    level: confLogger.level
}))
let dbc
try {
    dbc = await mysql.createConnection(confDb)
} catch(err) { 
    logger.error('DB connection error: ' + err.message)
    process.exit(1)
}

let solPrice = 0
let totalSols = 0
let netSolsPerHour = 0
let netHashrate = 0

try {
    let data  = fs.readFileSync(__dirname + '/data/maininfo.json', 'utf8')
    data = JSON.parse(data)
    if (data.curSolPrice) solPrice = data.curSolPrice
    if (data.total.solutions) totalSols = data.total.solutions
    if (data.netSolsPerHour) netSolsPerHour = data.netSolsPerHour
    if (data.netHashrate) netHashrate = data.netHashrate
} catch (err) {
    logger.warn({err})
}


try {
    let price = 0
    price = await getPrice(5000)
    fs.writeFile(__dirname + '/data/price.txt', price.toString(), err => { 
        if(err) throw err
    })
} catch(err) {
    logger.warn(err, 'price processing error')
}

try {
    let data = await calculateStatistics(dbc)
    /*data = Object.entries(data.users)
    data.forEach(([key, item]) => {
        const potencialSols = 7 * 24 * item.statistics[0] * netSolsPerHour / netHashrate
        item.revenue = {
            solulions: Math.round(item.statistics[1] * totalSols) / 100,
            potencialSols: Math.round(potencialSols * 100) / 100,
            potencialUSD: Math.round(potencialSols * solPrice * 100 * 0.84) / 100, // commission 16%
        }
    })*/

    for (var key in data.users) {
        if (data.users.hasOwnProperty(key)) {
            const potencialSols = 7 * 24 * data.users[key].statistics[0] * netSolsPerHour / netHashrate
            data.users[key].revenue = {
                solulions: Math.round(data.users[key].statistics[1] * totalSols) / 100,
                potencialSols: Math.round(potencialSols * 100) / 100,
                potencialUSD: Math.round(potencialSols * solPrice * 100 * 0.84) / 100, // commission 16%
            }
            data.users[key].statistics[1] = Math.round(data.users[key].statistics[1] * 100) / 100

            // time indexes 3, 4. 	2024-05-01T13:00:19 to 	2024-05-01T13:00
            data.users[key].workers.forEach((item, workerKey) => {
                item[3] = item[3].slice(0, item[3].lastIndexOf(':'))
                item[4] = item[4].slice(0, item[4].lastIndexOf(':'))

                const [d, h, m] = minutesToDays(item[5])
                item[6] = item[5] >= confQubic.minActiveMinutes
                item[5] = (d > 0 ? `${d} d ` : "") + (h > 0 ? `${h} h ` : '') + `${m} min`
                data.users[key].workers[workerKey] = item
            });
        }
    }

    fs.writeFileSync(__dirname + '/data/calc-stats.json', JSON.stringify(data), err => { 
        if(err) throw new Error(err)
    })   
} catch (err) {
    logger.error({err})
}
if (dbc && dbc.end) {
    dbc.end()
}
