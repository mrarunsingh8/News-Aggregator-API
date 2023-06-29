const express = require("express");
const appDB = require("./../db.json");
const newsRouter = express.Router();
const fs = require("fs");
const path = require("path");

newsRouter.get("/", (req, res)=>{
    const data = appDB.news;

    res.status(200).json({
        statusCode: 200,
        data: data
    });
});

newsRouter.get("/:id", (req, res) => {
    let id  = req.params.id;
    const data = appDB.news.filter((item)=>{
        return item.id == id;
    });    
    if(data.length > 0){
        res.status(200).json({
            statusCode: 200,
            data: data[0]
        });
    }else{
        res.status(404).json({
            statusCode: 404,
            data: {}
        });
    }
});

newsRouter.post("/", (req, res) => {
    let reqBody = req.body;
    let data = appDB.news.filter((item)=> item.id === reqBody.id);

    if(data.length > 0){
        res.status(400).json({
            statusCode: 400,
            error: `Bad Request! id ${reqBody.id} already exist in DB.`
        });
    }else{
        let newData = {...appDB};
        newData.news.push(reqBody);
        fs.writeFile(path.join(__dirname, "../", "db.json"), JSON.stringify(newData), {encoding: "utf8", flag: "w"}, (err)=>{
            if(err){
                res.status(400).json({
                    statusCode: 400,
                    error: err.message
                });
            }else{
                res.status(200).json({
                    statusCode: 200,
                    message: "A news has beed added succuessfully."
                });
            }
        });
    }
});

newsRouter.put("/", (req, res) => {
    let reqBody = req.body;
    let data = appDB.news.filter((item)=> item.id === reqBody.id);

    if(data.length > 0){
        let newData = {...appDB};
        newData.news = newData.news.map((item)=>{
            if(item.id === reqBody.id){
                return {
                    ...item,
                    title: reqBody.title,
                    description: reqBody.description
                }
            }
            return item;
        });
        fs.writeFile(path.join(__dirname, "../", "db.json"), JSON.stringify(newData), {encoding: "utf8", flag: "w"}, (err)=>{
            if(err){
                res.status(400).json({
                    statusCode: 400,
                    error: err.message
                });
            }else{
                res.status(200).json({
                    statusCode: 200,
                    message: `The news is updated for the id: ${reqBody.id}`
                });
            }
        });
    }else{
        res.status(400).json({
            statusCode: 400,
            error: `Bad Request! id ${reqBody.id} doesn't exist in DB.`
        });
    }
});

newsRouter.patch("/", (req, res) => {
    let reqBody = req.body;
    let data = appDB.news.filter((item)=> item.id === reqBody.id);
    if(data.length > 0){
        let newData = {...appDB};
        newData.news = newData.news.map((item)=>{
            if(item.id === reqBody.id){
                return {
                    ...item,
                    title: reqBody.title
                }
            }
            return item;
        });
        fs.writeFile(path.join(__dirname, "../", "db.json"), JSON.stringify(newData), {encoding: "utf8", flag: "w"}, (err)=>{
            if(err){
                res.status(400).json({
                    statusCode: 400,
                    error: err.message
                });
            }else{
                res.status(200).json({
                    statusCode: 200,
                    message: `The news is updated for the id: ${reqBody.id}`
                });
            }
        });
    }else{
        res.status(400).json({
            statusCode: 400,
            error: `Bad Request! id ${reqBody.id} doesn't exist in DB.`
        });
    }
});


newsRouter.delete("/:id", (req, res) => {
    let id = req.params.id;
    let newData = {...appDB};
    newData.news = newData.news.filter((item)=> item.id != id);
    console.log(newData.news);
    fs.writeFile(path.join(__dirname, "../", "db.json"), JSON.stringify(newData), {encoding: "utf8", flag: "w"}, (err)=>{
        if(err){
            res.status(400).json({
                statusCode: 400,
                error: err.message
            });
        }else{
            res.status(200).json({
                statusCode: 200,
                message: `The news is deleted for the id: ${id}`
            });
        }
    });
});

module.exports = newsRouter;