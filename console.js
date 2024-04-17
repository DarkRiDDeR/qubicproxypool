
import { argv } from 'node:process'
import { stat } from 'node:fs'
import { match } from 'node:assert'
import { confLogger, confUsers } from "./config.js"
import { dbConnect, dbCreateUser, getCurrentEpoch, getTimestampOfLastWednesday, getPasswordHash } from "./functions.js"

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
    dbc = await dbConnect()
} catch(err) { 
    log.error('DB connection error: ' + err.message)
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
} else if (argv[2] == 'user-add') {
    if (argv.length != 7) {
        console.error('Error: add user command "adduser <login> <email> <password> <wallet>"')
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
} else if (argv[2] == 'calculate') {

} else {
    console.error('Error: command not find')
}

try {
    dbc.end()
} catch(err) { 
    log.warning('DB end error: ' + err.message)
}