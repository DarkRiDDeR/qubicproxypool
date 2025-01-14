/*
CREATE DATABASE qubic_proxy_pool;
CREATE USER 'qubic_user'@'localhost' IDENTIFIED BY 'qubic_pass';
GRANT ALL PRIVILEGES ON qubic_proxy_pool.* TO 'qubic_user'@'localhost';
USE qubic_proxy_pool;
*/

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- База данных: `qubic`
--

-- --------------------------------------------------------

CREATE TABLE `users` (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    login VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(64) NOT NULL,
    wallet VARCHAR(60),
    reset VARCHAR(64)  DEFAULT NULL,
    reset_time TIMESTAMP  DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `workers` (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    user_id INTEGER NOT NULL,
    UNIQUE(name, user_id),
    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `workers_statistics` (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    user_id INTEGER NOT NULL,
    worker_id INTEGER NOT NULL,
    time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version VARCHAR(15) DEFAULT NULL,
    hashrate INTEGER DEFAULT NULL,
    solutions INTEGER NOT NULL DEFAULT '0',
    is_active BOOLEAN DEFAULT NULL,
    last_active TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (worker_id) REFERENCES workers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `epochs` (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    epoch INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    avg_hashrate INTEGER DEFAULT NULL,
    solutions INTEGER NOT NULL DEFAULT '0',
    share DOUBLE DEFAULT NULL,
    payout INTEGER DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `solutions` (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  epoch INTEGER DEFAULT NULL,
  number INTEGER DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `payments` (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    user_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    wallet VARCHAR(60) NOT NULL,
    percentage DOUBLE NOT NULL,
    value INTEGER NOT NULL DEFAULT '0',
    isSent BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(user_id, epoch),
    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;