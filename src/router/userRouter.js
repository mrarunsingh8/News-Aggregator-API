const userRouter = require("express").Router();
const uuid = require("uuid");
const path = require("path");
const fs  =require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const appDB = require(`../${process.env.FILE_DB_NAME}`);
const loginValidator = require("../validators/loginValidator");
const userValidator = require("../validators/userValidator");


userRouter.post("/login", (req, res)=>{
    let postData = {
        email: req.body.email,
        password: req.body.password
    }

    const {error} = loginValidator.validate(postData);
    if (error) {
        return res.status(400).json({
            statusCode: 400,
            dateTime: new Date(),
            message: "Validation error.",
            errors: error.details,
        });
    }

    let checkUserExistance = (appDB.users)?appDB.users.filter(item => item.email === postData.email):[];
    checkUserExistance = (checkUserExistance.length > 0)?checkUserExistance[0]:{};
    if (!(Object.keys(checkUserExistance).length > 0)) {
        return res.status(400).json({
            statusCode: 400,
            dateTime: new Date(),
            message: "Email is not exist.",
            errors: new Error("Email is not exist"),
        });
    }
    let checkPassword = bcrypt.compareSync(postData.password, checkUserExistance.password);
    if(!checkPassword){
        return res.status(400).json({
            statusCode: 400,
            dateTime: new Date(),
            message: "Password doesn't match.",
            errors: new Error("Password doesn't match"),
        });
    }

    const payload = {
        id: checkUserExistance.id,
        email: checkUserExistance.email,
        name: checkUserExistance.name,
        exp: Math.floor(new Date() / 1000) + (60*60)
    }
    const token = jwt.sign(payload, process.env.SECRET_KEY);

    return res.status(200).json({
        statusCode: 200,
        dateTime: new Date(),
        message: "Login Successfull.",
        token: token,
    });
});

userRouter.post("/register", (req, res) => {
    let userData = {
        name: req.body.name,
        email: req.body.email,
        password: req.body.password
    }

    const { error, values } = userValidator.validate(userData);
    if (error) {
        res.status(400).json({
            statusCode: 400,
            dateTime: new Date(),
            message: "Validation error.",
            errors: error.details,
        });
        return false;
    }

    const checkUserExistance = ("users" in appDB) ? appDB.users.filter(item => item.email == userData.email) : {};
    if (Object.keys(checkUserExistance).length > 0) {
        res.status(400).json({
            statusCode: 400,
            dateTime: new Date(),
            message: "Email Already Exist.",
            errors: new Error("Email Already Exist."),
        });
        return false;
    }

    if (!("users" in appDB)) {
        appDB.users = [];
    }
    userData.id = uuid.v1();
    userData.password = bcrypt.hashSync(userData.password, 5);
    appDB.users.push(userData);
    let filePath = path.join(__dirname, "../", `${process.env.FILE_DB_NAME}`);
    fs.writeFileSync(filePath, JSON.stringify(appDB), {encoding: "utf8", flag: "w"});
    return res.status(201).json({
        statusCode: 201,
        dateTime: new Date(),
        message: `A new user has been added with the userId: ${userData.id}`
    });
});

module.exports = userRouter;