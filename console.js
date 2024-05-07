import { argv } from 'node:process'
import { stat } from 'node:fs'
import { match } from 'node:assert'
import mysql from 'mysql2/promise'
import moment from 'moment'
import { confUsers, confDb, confEpoch, confQubic } from "./config.js"
import { minutesToDays, dbCreateUser, getCurrentEpoch, getTimestampOfLastWednesday, getPasswordHash, getPrice, calculateStatistics, compareMinerVersion } from "./functions.js"

/*Launching the Node.js process as:
node process-args.js one two=three four 

Would generate the output:
0: /usr/local/bin/node
1: /Users/mjr/work/node/process-args.js
2: one
3: two=three
4: four */

if (!argv[2]) {
    console.error('Error: command not defined');
    process.exit(1)
}

let dbc
try {
    dbc = await mysql.createConnection(confDb)
} catch(err) { 
    console.log('DB connection error: ' + err.message)
    process.exit(1)
}

if (argv[2] == 'install') {
    for(const user of confUsers.initDbUsers) {
        console.log(user)
        dbCreateUser(dbc, user[0].toLowerCase(), user[1], user[2], user[3])
    }
} else if (argv[2] == 'sql' && argv[3]) {
    try {
        console.log(await dbc.query(argv[3]))
    } catch (err) {
        console.log(err)
    }
} else if (argv[2] == 'users') {
    const [rows] = await dbc.query({sql: 'SELECT login, email, wallet FROM users ORDER BY login', rowsAsArray: true})
    rows.forEach(item => {
        console.log(item[0] + '   ' + item[1] + '   ' + item[2])
    })
} else if (argv[2] == 'user-add') {
    if (argv.length != 7) {
        console.error('Error: add user command "add-user <login> <email> <password> <wallet>"')
    } else {
        console.log(await dbCreateUser(dbc, argv[3].toLowerCase(), argv[4].toLowerCase(), argv[5], argv[6]))
    }
} else if (argv[2] == 'user-get' && argv[3]) {
    try {
        const [rows] = await dbc.query({sql: 'SELECT login, email, wallet FROM users WHERE login = ?', rowsAsArray: true}, [argv[3]])
        if (rows.length){
            console.log(rows[0])
        }
    } catch (err) {
        console.log(err)
    }
} else if (argv[2] == 'user-change' && argv[3] && argv[4]) {
    let rows
    if (argv[5]) { // wallet
        [rows] = await dbc.query('UPDATE users SET password = ?, wallet = ? WHERE login = ?', [getPasswordHash(argv[4]), argv[5], argv[3]])
    } else {
        [rows] = await dbc.query('UPDATE users SET password = ? WHERE login = ?', [getPasswordHash(argv[4]), argv[3]])
    }
    console.log(rows.info)
} else if (argv[2] == 'epoch') {
    let [epoch, progress] = getCurrentEpoch()
    progress = Math.round(progress * 10000) / 100
    let startDate = new Date(getTimestampOfLastWednesday())
    console.log(`Epoch=${epoch}; Progress: ${progress}%; Start date: ` + startDate.toISOString())

} else if (argv[2] == 'calc') { // epoch, enableMinActivity = false
    let data = await calculateStatistics(dbc, argv[3], argv[4] === 'true' || argv[4] === '1')
    if (!data.users.length) console.log([])

    const [rows] = await dbc.query({sql: 'SELECT id, login, wallet FROM users WHERE id IN (' + Object.keys(data.users).join(',') + ') ORDER BY login', rowsAsArray: true})
    rows.forEach(row => {
        console.log(row[1] + '   ' + data.users[row[0]].statistics[1] + '   ' + row[2])
    })

} else if (argv[2] == 'detect-old-verion') {
    let epoch = argv[3]
    if (!epoch) {
        epoch = getCurrentEpoch()[0]
    }
    let start = confEpoch.timestamp / 1000 + 604800 * (epoch - confEpoch.number) + 3600// старт после 1 часа эпохи
    let finish = start + 604800 - 3600
    let data = new Map()

    const [rows] = await dbc.query(
        {
            sql: `
                SELECT DISTINCT id, worker_id, user_id, time,  hashrate, version
                FROM workers_statistics
                WHERE time>= ? and time < ?
                ORDER BY id
            `, rowsAsArray: true
        },
        [moment.unix(start).format('YYYY-MM-D HH:mm:ss'), moment.unix(finish).format('YYYY-MM-D HH:mm:ss')]
    )
    if (rows.length) {
        rows.forEach(row => {
            if (compareMinerVersion(row[5], confQubic.minVersion) == -1 && !data.has(row[1])) {
                data.set(row[1], row)
            }
        })
    }
    console.log(data)

} else if (argv[2] == 'low-activity') {
    let epoch = parseInt(argv[3])
    if (!epoch) epoch = getCurrentEpoch()[0]
    let start = confEpoch.timestamp / 1000 + 604800 * (epoch - confEpoch.number) + 3600// старт после 1 часа эпохи
    let finish = start + 604800 - 3600

    const [usersRows] = await dbc.query({sql: 'SELECT id, login FROM users', rowsAsArray: true})
    const [rows] = await dbc.query(
        {sql: `
                SELECT DISTINCT UNIX_TIMESTAMP(time) AS timestamp, workers_statistics.worker_id, is_active, CONCAT(users.login, '.', workers.name)
                FROM workers_statistics
                INNER JOIN workers ON workers.id = workers_statistics.worker_id
                INNER JOIN users ON users.id = workers_statistics.user_id
                WHERE time>= ? and time < ?
                ORDER BY timestamp
            `, rowsAsArray: true
        },
        [moment.unix(start).format('YYYY-MM-D HH:mm:ss'), moment.unix(finish).format('YYYY-MM-D HH:mm:ss')]
    )
    //console.log(rows)
        
    let hashratesForTime = [] // [[time, [worker_id, isActive, alias]]..]
    let timestamp = rows[0][0]
    let item = []
    let currentItem
    rows.forEach(row => {
        if (timestamp != row[0]) {
            hashratesForTime.push([timestamp, item])
            timestamp = row[0]
            item = []
        }
        item.push([row[1], row[2], row[3]])
    })
    hashratesForTime.push([timestamp, item])
    start = rows[0][0]
    finish = rows[rows.length - 1][0]
    //console.log(hashratesForTime[0])

    // detect workers with low activity
    let workers
    currentItem = hashratesForTime.shift()
    workers = new Map() // [id, [userId, minutes]]
    for(let i = start; i <= finish; i += 60) {
        if (currentItem[0] < i) {
            currentItem = hashratesForTime.shift()
        }
        currentItem[1].forEach((workerItem) => {
            if (workerItem[1]) {
                if (workers.has(workerItem[0])) {
                    item = workers.get(workerItem[0])
                    item[0]++
                    workers.set(workerItem[0], item)
                } else {
                    workers.set(workerItem[0], [1, workerItem[2]])
                }
            }
        })
    }
    //console.log(workers)
    workers.forEach((item, key) => {
        if (item[0] >= confQubic.minActiveMinutes) workers.delete(key)
    })
    workers = [...workers.values()]
    workers.sort((a,b) => (a[1] > b[1] ? 1 : -1))
    workers.forEach(item => {
        const [d, h, m] = minutesToDays(item[0])
        console.log(item[1] + ' ' + (d<9?'0':'') + `${d}d_` + (h<9?'0':'') + `${h}h_` + (m<9?'0':'') + `${m}min`)
    })
    
} else if (argv[2] == 'price') {
    console.log(await getPrice())

} else {
    console.error('Error: command not find')
}

try {
    dbc.end()
} catch(err) { 
    log.warning('DB end error: ' + err.message)
}