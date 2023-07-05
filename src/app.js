require('dotenv').config()
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

app.listen(3000, (err)=>{
    if(err) console.error("Error", err);
    console.log("Server started on Port: 3000");
});