import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'
import { CoinGeckoClient } from 'coingecko-api-v3'
import { confDb, confEpoch, confQubic} from './config.js'
import moment from 'moment'
import { match } from 'node:assert'

export function compareMinerVersion (v1, v2) {
    let [v11, v12, v13] = v1.split('.')
    let [v21, v22, v23]  = v2.split('.')
    v11 = parseInt(v11)
    v12 = v12 ? parseInt(v12) : 0
    v13 = v13 ? parseInt(v13) : 0
    v21 = parseInt(v21)
    v22 = v22 ? parseInt(v22) : 0
    v23 = v23 ? parseInt(v23) : 0

    if (v11 > v21) return 1
    else if (v11 == v21) {
        if (v12 > v22) return 1
        else if (v12 == v22) {
            if (v13 > v23) return 1
            else if (v13 == v23) return 0
        }
    }
    return -1
}

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
 * 
 * @param {*} epoch 
 * @returns seconds
 */
export function  getEpochStartTimestamp(epoch) {
    if (!epoch) {
        epoch = getCurrentEpoch()[0]
    }
    return confEpoch.timestamp / 1000 + 604800 * (epoch - confEpoch.number)
}

/**
 * @returns true or error message 
 */
export function dbConnect(){
    return mysql.createPool(confDb)
}



export function dbCreateUser(dbc, login, email, password, wallet = '') {
    return dbc.query(
        'INSERT INTO users(login, email, password, wallet) VALUES (?,?,?,?)',
        [login, email, getPasswordHash(password), wallet]
    )
}

export async function dbVerifyUser(dbc, login, password) {
    const [rows] = await dbc.query(
        {sql: 'SELECT id FROM users WHERE login = ? AND password = ?', rowsAsArray: true},
        [login, getPasswordHash(password)]
    )
    return rows.length > 0 ? rows[0][0] : false
}

export async function getPrice(timeout = 10000) {
    const client = new CoinGeckoClient({timeout})
    const res = await client.simplePrice({ids:'qubic-network', vs_currencies:'usd'})
    if (res['qubic-network']) {
        return res['qubic-network']['usd']
    }
    return null
}

/**
 * 
 * @param {*} token 
 * @param {*} workerId 
 * @param {*} timeout = 5000
 * @returns 
 */
export function qubicClearWorker (token, workerId, timeout = 5000) {
    return fetch('https://api.qubic.li/My/MinerControl/Clear/' + workerId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': confQubic.userAgent
        },
        timeout: timeout,
    })
}

export async function calculateStatistics(dbc, epoch) {
    if (!epoch) {
        epoch = getCurrentEpoch()[0]
    }
    let start = confEpoch.timestamp / 1000 + 604800 * (epoch - confEpoch.number) + 3600// старт после 1 часа эпохи
    let finish = start + 604800 - 3600
    let data = {users: {}, totalPrct: 0}

    const [usersRows] = await dbc.query({sql: 'SELECT id, login FROM users', rowsAsArray: true})
    const [rows] = await dbc.query(
        {
            sql: `
                SELECT DISTINCT UNIX_TIMESTAMP(time) AS timestamp, user_id, worker_id, hashrate, is_active, last_active
                FROM workers_statistics
                WHERE time>= ? and time < ?
                ORDER BY timestamp
            `, rowsAsArray: true
        },
        [moment.unix(start).format('YYYY-MM-D HH:mm:ss'), moment.unix(finish).format('YYYY-MM-D HH:mm:ss')]
    )
    if (!rows.length) {
        return data
    }
    let hashratesForTime = [] // [[time, [user_id, worker_id, hashrate, isActive, lastActivity]]..]
    let timestamp = rows[0][0]
    let item = []
    let isInactive = false
    let is0Its = false
    rows.forEach(row => {
        if (timestamp != row[0]) {
            hashratesForTime.push([timestamp, item])
            timestamp = row[0]
            item = []
        }
        item.push([row[1], row[2], row[3], row[4], row[5]])
    })
    hashratesForTime.push([timestamp, item])

    let currentItem = hashratesForTime.shift() // [[userId, workerId, hashrate, isActive, lastActivity]..]]
    start = rows[0][0]
    finish = rows[rows.length - 1][0]
    let totalMinutes = Math.ceil((finish - start) / 60)
    let totalActiveMinutes = totalMinutes
    const userStatsEpoch = new Map() // [[userId, [hashrateSum, procentSum]...]
    const prevWorkerHashrates = new Map() // [[workerId => hashrate]...]
    const workerStatsEpoch = new Map() // [[workerId => [hashrateSum, activeMinutes, startActivity, lastActivity]...]
    // поминутный перебор
    for(let i = start; i <= finish; i += 60) {
        if (currentItem[0] < i) {
            currentItem = hashratesForTime.shift()
        }
        //if (!currentItem) onsole.log('empty block')

        let hashrateSumForMinute = 0

        let userStats = new Map()// [[userId , [hashrateSum, procentSum]]...] // статистика на пользователя в минуту
        currentItem[1].forEach((workerItem) => {
            //console.log(workerItem)
            if (!workerItem[3]) { //если неактивен, то нулевой хешрейт
                workerItem[2] = 0
            } else if (workerItem[2] == 0 && prevWorkerHashrates.has(workerItem[1])) {  // если активен, но хешрейт ещё не определился = 0, то берём предыдущий при его наличии
                workerItem[2] = prevWorkerHashrates[workerItem[1]]
            }
            prevWorkerHashrates[workerItem[1]] = workerItem[2]
            
            let workerStatsEpochItem = [0, 0, '', '']
            if (workerStatsEpoch.has(workerItem[1])) {
                workerStatsEpochItem = workerStatsEpoch.get(workerItem[1])
            }
            workerStatsEpochItem[0] += workerItem[2] // суммарный хешрейт на воркера.
            if (workerItem[3]) ++workerStatsEpochItem[1] // активные минуты воркера
            if (!workerStatsEpochItem[2]) workerStatsEpochItem[2] = moment.unix(i) // startActivity
            workerStatsEpochItem[3] = workerItem[4] // last activity
            hashrateSumForMinute += workerItem[2]
            workerStatsEpoch.set(workerItem[1], workerStatsEpochItem)

            let userStatsItem = [0, 0]
            if (userStats.has(workerItem[0])) {
                userStatsItem = userStats.get(workerItem[0])
            }
            userStatsItem[0] += workerItem[2]
            userStats.set(workerItem[0], userStatsItem)
        })

        if (!hashrateSumForMinute) {
            totalActiveMinutes--
        } else {
            userStats.forEach((userItem, userId) => {
                let userStatsEpochItem = [0, 0]
                if (userStatsEpoch.has(userId)) {
                    userStatsEpochItem = userStatsEpoch.get(userId)
                }
                userStatsEpochItem[0] += userItem[0]
                userStatsEpochItem[1] += userItem[0] / hashrateSumForMinute
                userStatsEpoch.set(userId, userStatsEpochItem)
            })
        }
    }
    /*console.log([
        totalMinutes,
        workerStatsEpoch
    ])*/

    let procentSum = 0
    const [dbUsers] = await dbc.query({sql: `SELECT id, login, wallet FROM users ORDER BY login`, rowsAsArray: true})
    //console.log('Users (avg. hshrate / % in epoch):')
    //console.log(dbUsers)
    //console.log(userStatsEpoch)
    dbUsers.forEach((item) => {
        const userStat = userStatsEpoch.get(item[0])
        if (userStat) {
            let procent = userStat[1] * 100 / totalActiveMinutes
            procentSum += procent
            data.users[item[0]] = {
                login: item[1],
                statistics: [ // avg. hshrate / %
                    Math.round(userStat[0] / totalMinutes),
                    procent
                ],
                workers: []
            }
        }
    })
    data.totalPrct = procentSum
    //console.log(data)
    //console.log(`Total procent = ${procentSum}%\n\n`)

    const strWorkerIds = [...workerStatsEpoch.keys()].join(',')
    const [dbWorkers] = await dbc.query({sql: `SELECT id, user_id, name FROM workers WHERE id IN (${strWorkerIds}) ORDER BY name`, rowsAsArray: true})

    const date = new Date(start * 1000)
    const date2 = new Date(finish * 1000)
    //console.log(`Period:\n${date.toUTCString()} - ${date2.toUTCString()}`)
    //console.log('Workers (avg. hshrate / % activity):')
    dbWorkers.forEach((item) => {
        const stat = workerStatsEpoch.get(item[0])
        if (!stat[1]) {
            stat[1] = 1
        }
        data.users[item[1]].workers.push([
            item[2],
            Math.round(stat[0] / stat[1]), // avg. hshrate, only activity minutes
            Math.round(stat[1] / totalMinutes * 10000) / 100, // % activity
            stat[2].toISOString().split('.')[0], // start activity
            stat[3].toISOString().split('.')[0], // last activity
            stat[1] // active minutes
        ])
        //console.log(item[2] + ' = ' + Math.round(stat[0] / totalMinutes) + ' Its / ' + (Math.round(stat[1] * 60 / totalMinutes * 100) / 100) + ' %')
    })
    //console.log(JSON.stringify(data, null, 2))
    //console.log(data.users[9].workers)
    return data
}

/**
 * 
 * @param {*} dbc 
 * @param {*} interval - seconds
 * @param {*} epoch 
 * @returns object {time => sols}
 */
export async function getSolsStatistics(dbc, interval = 3600, epoch) {
    if (!epoch) {
        epoch = getCurrentEpoch()[0]
    }
    let start = confEpoch.timestamp / 1000 + 604800 * (epoch - confEpoch.number)
    let finish = start + 604800

    const [rows] = await dbc.query(
        {sql: `SELECT DISTINCT UNIX_TIMESTAMP(time) AS timestamp, number FROM solutions WHERE time>= ? and time < ? ORDER BY timestamp`, rowsAsArray: true},
        [moment.unix(start + 3600).format('YYYY-MM-D HH:mm:ss'), moment.unix(finish).format('YYYY-MM-D HH:mm:ss')] // старт после 1 часа эпохи
    )

    const data = new Map() // [time, sols]
    for(let i = start; i <= finish; i += interval) {
        data.set(i, 0)
    }

    if (rows.length) {
        let prevRow = rows[0] //[time, sols]
        data.set(prevRow[0] - (prevRow[0] - start) % interval, prevRow[1]) + interval

        rows.forEach(row => {
            if(row[1] > prevRow[1]) {
                const key = row[0] - (row[0] - start) % interval + interval
                data.set(
                    key,
                    data.get(key) + row[1] - prevRow[1]
                )
                prevRow = row
            }
        })
    }
    return data
}

/**
 * 
 * @param {*} minutes
 * @returns [day, hour, minute]
 */
export function minutesToDays(minutes) {
    let day = Math.floor(minutes / 1440),
        hour = Math.floor((minutes - day * 1440) / 60),
        minute = Math.round(minutes - day * 1440 - hour * 60)
    if (minute === 60) {
        hour++
        minute = 0
    }
    if (hour === 24) {
        day++
        hour = 0
    }
    return [day, hour, minute]
}