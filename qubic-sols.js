import pino from 'pino'
import fs from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import mysql from 'mysql2/promise'
import moment from 'moment'
import { confLogger, confDb, confEpoch } from "./config.js"
import { getCurrentEpoch, getSolsStatistics } from "./functions.js"

process.env.TZ = "UTC"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const logger = pino(pino.destination({
    //dest: './logs/qubic-sols.log',
    level: confLogger.level
}))
let dbc
try {
    dbc = await mysql.createConnection(confDb)
} catch(err) { 
    logger.error('DB connection error: ' + err.message)
    process.exit(1)
}

try {
    let data = await getSolsStatistics(dbc, 7200)
    fs.writeFileSync(__dirname + '/data/solutions.json', JSON.stringify(Object.fromEntries(data)), err => { 
        if(err) logger.error({err})
    })
} catch (err) {
    logger.error({err})
}
if (dbc && dbc.end) {
    dbc.end()
}
