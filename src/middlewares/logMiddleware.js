const winston = require("winston");

const logMiddleware = winston.createLogger({
    level: 'error', // Set the logging level to 'error' or lower to capture errors
    format: winston.format.json(), // Use JSON format for logs
    transports: [
        new winston.transports.Console(), // Log to the console
        new winston.transports.File({ filename: '.logs/logfile.log' }) // Log to a file
    ]
});

module.exports = logMiddleware;