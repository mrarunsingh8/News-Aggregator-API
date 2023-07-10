const preferenceRouter = require("express").Router();
const fs = require("fs");
const path = require("path");

const appDB = require(`../${process.env.FILE_DB_NAME}`);
const preferenceValidator = require("../validators/preferenceValidator");

preferenceRouter.get("/", (req, res)=>{
    let user = (appData.users).filter((item) => {
        if(item.id == req.user.id){
            return item??[];
        }
    });
    let preferences = [];
    if(user.length > 0){
        preferences = user[0].preference;
    } 
    return res.status(201).json({
        statusCode: 200,
        dateTime: new Date(),
        preferences: preferences
    });   
});


preferenceRouter.put("/", (req, res)=>{
    let data = {
        preference: req.body.preference,
    }
    const { error, values } = preferenceValidator.validate(data);
    
    if(error){
        return res.status(400).json({
            statusCode: 400,
            dateTime: new Date(),
            message: "Validation error.",
            errors: error.details,
        });
    }
    appData.users = appData.users.map((item)=>{
        if(item.id == req.user.id){
            item.preference = data.preference;
        }
        return item;
    });

    try{
        fs.writeFileSync(path.join(__dirname, "../", "db.json"), JSON.stringify(appData), {encoding: "utf8", flag: "w"});
        return res.status(200).json({
            statusCode: 200,
            message: `The preference has been updated now`
        });
    }catch(err){
        return res.status(200).json({
            statusCode: 400,
            error: err
        });
    };
});

module.exports = preferenceRouter;