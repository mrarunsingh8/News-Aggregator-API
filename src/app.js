require('dotenv').config()
const express = require("express");
const bodyParser = require("body-parser");

const authRouter = require("./router/authRouter");
const newsRouter = require("./router/newsRouter");
const userRouter = require("./router/userRouter");
const authMiddleware = require('./middlewares/authMiddleware');

const app = express();

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

app.get("/", (req, res)=>{
    res.send("Hello World");
});

app.use("/api/v1/login", authRouter);

app.use("/api/v1", userRouter);

app.use("/api/v1/news", authMiddleware, newsRouter);

app.listen(3000, (err)=>{
    if(err) console.error("Error", err);
    console.log("Server started on Port: 3000");
});