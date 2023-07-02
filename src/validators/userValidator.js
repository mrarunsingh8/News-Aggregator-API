const Joi = require("joi");

const userValidator = Joi.object({
    name: Joi.string().required().label("name"),
    email: Joi.string().email().required().label("email"),
    password: Joi.string().min(6).max(10).required().label("password"),
});

module.exports = userValidator;