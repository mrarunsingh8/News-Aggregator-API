const Joi = require("joi");

const preferenceValidator = Joi.object({
    preference: Joi.string().required().label("preference")
});

module.exports = preferenceValidator;