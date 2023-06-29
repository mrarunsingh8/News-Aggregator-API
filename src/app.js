const express = require("express");
const bodyParser = require("body-parser");

const newsRouter = require("./router/newsRouter");

const app = express();

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

app.get("/", (req, res)=>{
    res.send("Hello World");
});

app.use("/api/v1/news", newsRouter);

app.listen(3000, (err)=>{
    if(err) console.error("Error", err);
    console.log("Server started on Port: 3000");
});