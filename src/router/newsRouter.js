const express = require("express");
const fs = require("fs");
const path = require("path");
const newsServices = require("../services/newsServices");

const newsRouter = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const cacheMiddleware = require("../middlewares/cacheMiddleware");

const cacheDb = require("../cache.json");
const appData = require("../db.json");

newsRouter.get("/", cacheMiddleware, (req, res)=>{
    if(!req.user){
        newsServices.getNewsEverything().then(news=>{
            let newDb = {...cacheDb, [req.cacheKey]: {expireAt: new Date((new Date()).getTime() + 10 * 60000), news}};
            fs.writeFileSync(path.join(__dirname, "../", "cache.json"), JSON.stringify(newDb), {encoding: "utf8", flag: "w"});
            return res.status(200).json({
                statusCode: 200,
                dateTime: new Date(),
                news: news
            });
        }).catch((err)=>{
            return res.status(400).json({
                statusCode: 400,
                dateTime: new Date(),
                message: err.message,
                errors: err,
            });
        });
    }else{
        let user = (appData.users).filter((item) => {
            if(item.id == req.user.id){
                return item??[];
            }
        });
        let category = "";
        if(user.length > 0){
            category = user[0].preference;
        }
        newsServices.getnewsByCategories(category).then(news=>{
            let newDb = {...cacheDb, [req.cacheKey]: {expireAt: new Date((new Date()).getTime() + 10 * 60000), news}};
            fs.writeFileSync(path.join(__dirname, "../", "cache.json"), JSON.stringify(newDb), {encoding: "utf8", flag: "w"});
            return res.status(200).json({
                statusCode: 200,
                dateTime: new Date(),
                news: news
            });
        }).catch((err)=>{
            res.status(400).json({
                statusCode: 400,
                dateTime: new Date(),
                message: err.message,
                errors: err,
            });
        });
    }
});

newsRouter.get("/read", authMiddleware, (req, res) => {
    let filteredUser = appData.users.filter((item) => {
        if(item.id == req.user.id){
            return item;
        }
    });

    if(filteredUser[0].read){
        return res.status(200).json({
            statusCode: 200,
            data: filteredUser[0].read
        });
    }else{
        return res.status(200).json({
            statusCode: 200,
            message: `No record found.`
        });
    }
});


newsRouter.post("/:id/read", authMiddleware, (req,res)=>{
    let newsId = req.params.id;
    let news = req.body;
    appData.users.map((item)=>{
        if(item.id == req.user.id){
            item.read = (item.read)?item.read:[];
            let isExist = false;
            item.read = (item.read).map((readItem) => {
                if(readItem.id == newsId){
                    isExist = true;
                }
            });
            if(!isExist){
                (item.read).push(news);
            }
        }
        return item;
    });
    try{
        fs.writeFileSync(path.join(__dirname, "../", "db.json"), JSON.stringify(appData), {encoding: "utf8", flag: "w"});
        return res.status(200).json({
            statusCode: 200,
            message: `The news has been marked now as read`
        });
    }catch(err){
        return res.status(200).json({
            statusCode: 400,
            error: err
        });
    };
});

newsRouter.get("/favorite", authMiddleware, (req, res) => {
    let filteredUser = appData.users.filter((item) => {
        if(item.id == req.user.id){
            return item;
        }
    });

    if(filteredUser[0].favorites){
        return res.status(200).json({
            statusCode: 200,
            data: filteredUser[0].favorites
        });
    }else{
        return res.status(200).json({
            statusCode: 200,
            message: `No record found.`
        });
    }
});

newsRouter.post("/:id/favorite", authMiddleware, (req,res)=>{
    let newsId = req.params.id;
    let news = req.body;
    appData.users.map((item)=>{
        if(item.id == req.user.id){
            item.favorites = (item.favorites)?item.favorites:[];
            let isExist = false;
            item.favorites = (item.favorites).map((fabItem) => {
                if(fabItem.id == newsId){
                    isExist = true;
                }
            });
            if(!isExist){
                (item.favorites).push(news);
            }
        }
        return item;
    });
    try{
        fs.writeFileSync(path.join(__dirname, "../", "db.json"), JSON.stringify(appData), {encoding: "utf8", flag: "w"});
        return res.status(200).json({
            statusCode: 200,
            message: `The news has been marked now as favorite`
        });
    }catch(err){
        return res.status(200).json({
            statusCode: 400,
            error: err
        });
    };
});

module.exports = newsRouter;