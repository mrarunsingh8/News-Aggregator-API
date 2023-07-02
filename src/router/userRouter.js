const userRouter = require("express").Router();
const uuid = require("uuid");
const path = require("path");
const fs  =require("fs");
const bcrypt = require("bcrypt");

const appDB = require("../db.json");
const userValidator = require("../validators/userValidator");


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
    let filePath = path.join(__dirname, "../", "db.json");
    fs.writeFileSync(filePath, JSON.stringify(appDB), {encoding: "utf8", flag: "w"});
    return res.status(201).json({
        statusCode: 201,
        dateTime: new Date(),
        message: `A new user has been added with the userId: ${userData.id}`
    });
});

module.exports = userRouter;