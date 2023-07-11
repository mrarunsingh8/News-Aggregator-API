const chai = require("chai");
const sinon = require("sinon");
const chaiHttp = require("chai-http");
const path = require("path");
const fs = require("fs");

const app = require("../../src/app");

const { getAuthToken } = require("./userRouter.test");

chai.use(chaiHttp);

let authToken = '';
let newsIds = [];

describe("/news News Router", () => {
  before(function (done) {
    authToken = getAuthToken();
    done();
  });


  it("Get /news  should return authentication error", (done) => {
    chai.request(app).get("/news").end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).status(200);
      chai.expect(body).to.have.property("news").that.is.an("array");
      if (body.news && body.news.length > 0 && body.news[0].id) {
        newsIds.push(body.news[0].id);
      }
      done();
    });
  });

  it("Get /news Should return success", (done) => {
    chai.request(app).get("/news").set("Authorization", authToken).end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).status(200);
      chai.expect(body).to.have.property("news").that.is.an("array");
      if (body.news && body.news.length > 0 && body.news[0].id) {
        newsIds.push(body.news[0].id);
      }
      done();
    });
  });

  it("GET /news/read should return authentication error", (done) => {
    chai.request(app).get("/news/read").end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).to.have.status(401);
      chai.expect(body).to.have.property("message").equals("JWT token missing");
      done();
    });
  });

  it("POST /news/:id/read Should return authentication error", (done) => {
    chai.request(app).post(`/news/${newsIds[0]}/read`).end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).to.have.status(401);
      done();
    });
  });

  it("Post /news/:id/read Should return success", (done) => {
    chai.request(app).post(`/news/${newsIds[0]}/read`).set("Authorization", authToken).end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).to.have.status(200);
      chai.expect(body).to.have.property("message").equals("The news has been marked now as read").that.is.an("string");
      done();
    });
  });

  it("GET /news/read Should return authentication error", (done) => {
    chai.request(app).get("/news/read").end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).to.have.status(401);
      done();
    });
  });

  it("GET /news/read Should return success", (done) => {
    chai.request(app).get("/news/read").set("Authorization", authToken).end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).to.have.status(200);
      chai.expect(body).to.have.property("data").that.is.an("array");
      done();
    });
  });

  it("POST /news/:id/favorite Should return authentication error", (done) => {
    chai.request(app).post(`/news/${newsIds[0]}/favorite`).end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).to.have.status(401);
      done();
    });
  });

  it("Post /news/:id/favorite Should return success", (done) => {
    chai.request(app).post(`/news/${newsIds[0]}/favorite`).set("Authorization", authToken).end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).to.have.status(200);
      chai.expect(body).to.have.property("message").equals("The news has been marked now as favorite").that.is.an("string");
      done();
    });
  });

  it("GET /news/favorite Should return authentication error", (done) => {
    chai.request(app).get("/news/favorite").end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).to.have.status(401);
      done();
    });
  });

  it("GET /news/favorite Should return success", (done) => {
    chai.request(app).get("/news/favorite").set("Authorization", authToken).end((err, res) => {
      if (err) {
        return done(err);
      }
      const { body } = res;
      chai.expect(res).to.have.status(200);
      chai.expect(body).to.have.property("data").that.is.an("array");
      done();
    });
  });

});
