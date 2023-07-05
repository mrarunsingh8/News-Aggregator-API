const axios = require("axios");

const APIKEY = "6cb80d0d6ca04d8b8291c42ccdc00634";
let API_URL = 'https://newsapi.org/v2';

const newsServices = {
    getNewsEverything: () => {
        let queryParams = {
            apiKey: APIKEY
        };
        return axios.get(`${API_URL}/top-headlines/sources?${new URLSearchParams(queryParams).toString()}`).then(result=>result.data.sources);
    },
    getnewsByCategories: (category) => {
        let queryParams = {
            apiKey: APIKEY
        };
        if(category!=''){
            queryParams.category= category;
        }
        return axios.get(`${API_URL}/top-headlines/sources?${new URLSearchParams(queryParams).toString()}`).then(result=>result.data.sources);
    }
};

module.exports = newsServices;