const envFile = (process.env.NODE_ENV !== "test") ? ".env" : `.${process.env.NODE_ENV}.env`;
console.log(envFile);
require("dotenv").config({ path: envFile });

const express = require("express");
const bodyParser = require("body-parser");
const rateLimit = require("express-rate-limit");

const newsRouter = require("./router/newsRouter");
const userRouter = require("./router/userRouter");
const authMiddleware = require('./middlewares/authMiddleware');
const preferenceRouter = require('./router/preferenceRouter');
const jwtMiddleware = require('./middlewares/jwtMiddleware');
const perfectExpressSanitizer = require('perfect-express-sanitizer');

const app = express();

let rateLimitter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minutes
    max: 100,
    message: {
        error: {
            code: 429,
            message: "Too Many Requests",
            description: "We're sorry, but you have exceeded the maximum number of requests allowed. Please try again later."
        }
    },
    standardHeaders: true,
    legacyHeaders: false
});
app.use(rateLimitter);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(perfectExpressSanitizer.clean({
    xss: true,
    noSql: true,
    sql: true
}));

app.use("/", userRouter);

app.use("/preferences", authMiddleware, preferenceRouter);

app.use("/news", jwtMiddleware, newsRouter);

module.exports = app;