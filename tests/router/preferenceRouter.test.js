const chai = require("chai");
const sinon = require("sinon");
const chaiHttp = require("chai-http");
const path = require("path");
const fs = require("fs");

const app = require("../../src/app");

const { getAuthToken } = require("./userRouter.test");



chai.use(chaiHttp);

let authToken='';

describe("/preferences Preference Router", () => {
  before(function (done) {
    authToken = getAuthToken();
    done();
  });

  it("GET /preferences should return JWT Token Missing ", (done) => {
    
    chai
      .request(app)
      .get("/preferences")
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).to.have.status(401);
        chai
          .expect(body)
          .to.have.property("message")
          .that.is.an("string")
          .equals("JWT token missing");
      });

    done();
  });

  it("GET /preferences should return unauthorized access", (done) => {
    
    chai
      .request(app)
      .get("/preferences")
      .set("Authorization", `JWT 12345`)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).to.have.status(401);
        chai
          .expect(body)
          .to.have.property("message")
          .that.is.an("string")
          .equals("Unauthorized access!");
      });
    done();
  });

  it("PUT /preferences should return validation error.", (done) => {
    const data = {
        preference: ""
    };
    chai
      .request(app)
      .put("/preferences")
      .set("Authorization", authToken)
      .send(data)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).status(400);
        chai.expect(body).to.have.property("message").equals("Validation error.");
      });
    done();
  });

  it("PUT /preferences should return success", (done) => {
    const data = {
        preference: "general"
    };
    chai
      .request(app)
      .put("/preferences")
      .set("Authorization", authToken)
      .send(data)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).to.have.status(200);
        chai
          .expect(body)
          .to.have.property("message")
          .that.is.an("string")
          .equals("The preference has been updated now");
      });
    done();
  });

  it("GET /preferences should return success", (done) => {
    
    chai
      .request(app)
      .get("/preferences")
      .set("Authorization", authToken)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).to.have.status(200);
        chai.expect(body).to.have.property("preferences").equals("general");
      });
    done();
  });

});
