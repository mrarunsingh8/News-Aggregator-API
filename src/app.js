const envFile = (process.env.NODE_ENV == "production") ? "./.env" : `./.${process.env.NODE_ENV.trim()}.env`;
console.log(envFile);
require("dotenv").config({ path: envFile });
const express = require("express");
const bodyParser = require("body-parser");

const newsRouter = require("./router/newsRouter");
const userRouter = require("./router/userRouter");
const authMiddleware = require('./middlewares/authMiddleware');
const preferenceRouter = require('./router/preferenceRouter');
const jwtMiddleware = require('./middlewares/jwtMiddleware');
const perfectExpressSanitizer = require('perfect-express-sanitizer');

const app = express();

app.use(bodyParser.urlencoded({extended: false}));
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