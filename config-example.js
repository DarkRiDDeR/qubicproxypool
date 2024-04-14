export const qubic = {
    login: '',
    password: '',
    specificDataServer: null
}
export const users = {
    admins: [2], // ids
    resetCodeActivity: 720, // minutes
    installBdUsers: [
        ['none', 'pass', 'none@example.com'], // no detect user for worker
        ['admin', 'pass', 'none@example.com', 'KNIJXAGWQREUSFCFOHGRBAZNAQZAILFQBPFRVWPOECGPFNATPBDOCWUCZKMN']
    ],
}

export const epoch = { 
    currentEpoch: 103, // number
    timestamp: 1712145600000 // timestamp in milliseconds
}
export const server = {
    host: '127.0.0.1',
    port: 3000,
    sessionSecretKey: 'qubicproxypool'
}

export const db = {
    host: '127.0.0.1',
    port: 3306,
    name: 'db',
    user: 'dbuser',
    password: 'dbpass',
}