const authRouter = require("express").Router();
const appDB = require("../db.json");
const loginValidator = require("../validators/loginValidator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

authRouter.post("/", (req, res)=>{
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

    let checkUserExistance = appDB.users.filter(item => item.email === postData.email);
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

module.exports = authRouter;