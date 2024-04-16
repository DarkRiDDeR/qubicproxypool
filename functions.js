import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'
import { confDb, confEpoch} from './config.js'

export function getPasswordHash(password) {
    return createHash('sha256').update('QubicPowerProxy' + password).digest('hex')
}

/**
 * @returns int Timestamp in milliseconds of last Wednesday. Example:  Wed, 13 Mar 2024 12:00:00 GMT = 1710331200
 */
export function getTimestampOfLastWednesday() {
    const date = new Date
    let time = date.getTime() % 604800000 + 43200000
    return date.getTime() - time
}

/**
 * 
 * @returns array [epoch, progress]
 */
export function getCurrentEpoch() {
    const date = new Date()
    let progress = (date.getTime() - confEpoch.timestamp) / 604800000
    let epoch = Math.floor(progress)
    progress = progress - epoch
    epoch += confEpoch.number
    return [epoch, progress]
}

/**
 * @returns true or error message 
 */
export function dbConnect(){
    return mysql.createConnection({
        host: confDb.host,
        user: confDb.user,
        database: confDb.name,
        password: confDb.password
    })
}



export function dbCreateUser(dbc, login, email, password, wallet = '') {
    return dbc.query(
        'INSERT INTO users(login, email, password, wallet) VALUES (?,?,?,?)',
        [login, email, getPasswordHash(password), wallet]
    )
}
