const express = require("express");
const axios = require("axios");
const router = express.Router();
const addSubmission = require("../judge");
const auth = require("../middleware/auth");
const Submission = require("../models/submission");
const { 
  pushJudgeProgressByUserId, 
  pushJudgeResultByUserId, 
  registerSubmissionForUser 
} = require("../websocket");

router.post("/", auth, (req, res) => {
  const solution = {
    problemName: req.body.problemName,
    code: req.body.code,
    language: req.body.language,
    verdict: "",
  };

  const operation = req.body.operation;
  const problemId = req.body.problemId;
  const userId = req.user._id;

  let submission = new Submission(solution);
  const submissionId = submission._id.toString();

  console.log(`New submission: ${submissionId}, user: ${userId}, operation: ${operation}`);

  registerSubmissionForUser(userId.toString(), submissionId, problemId);

  axios
    .get(`${process.env.BACK_SERVER_URL}/api/problem/${problemId}`)
    .then((problemResponse) => {
      const problem = problemResponse.data;
      
      const progressCallback = (status, data) => {
        console.log(`Progress for ${submissionId} (user ${userId}): ${status}`);
        pushJudgeProgressByUserId(userId.toString(), submissionId, status, data);
      };

      addSubmission(problem, submission, operation, (err, result) => {
        if (err) {
          console.log(err);
          pushJudgeProgressByUserId(userId.toString(), submissionId, "error", { message: err.message });
          return res
            .status(500)
            .json({ message: "Something Went Wrong! Try Again!!!" });
        }

        let finalResult = [];
        let verdicts = [],
          testcases = [];

        console.log(result);

        result.forEach((curResult) => {
          let newResult = {},
            curTestcase = {
              time: curResult.time,
              memory: curResult.memory,
            };

          for (let key in curResult) {
            if (curResult[key] !== false) {
              newResult[key] = curResult[key];
            }
            if (curResult[key] === true) {
              newResult["verdict"] = key;
              curTestcase["verdict"] = key;
              verdicts.push(key);
            }
          }
          testcases.push(curTestcase);
          finalResult.push(newResult);
        });

        submission.result = testcases;

        if (verdicts.includes("CE")) submission.verdict = "CE";
        else if (verdicts.includes("MLE")) submission.verdict = "MLE";
        else if (verdicts.includes("TLE")) submission.verdict = "TLE";
        else if (verdicts.includes("RTE")) submission.verdict = "RTE";
        else if (verdicts.includes("WA")) submission.verdict = "WA";
        else if (verdicts.includes("AC")) submission.verdict = "AC";

        console.log(submission.verdict, finalResult);

        const pushSuccess = pushJudgeResultByUserId(
          userId.toString(),
          submissionId,
          submission.verdict,
          finalResult,
          testcases
        );

        if (!pushSuccess) {
          console.log(`Failed to push result for ${submissionId} via WebSocket, user ${userId} may be disconnected`);
        }

        return res.send({ 
          submissionId,
          verdict: submission.verdict, 
          result: finalResult,
          pushedViaWebSocket: pushSuccess
        });
      }, progressCallback);
    })
    .catch((err) => {
      console.error(`Error fetching problem ${problemId}:`, err);
      pushJudgeProgressByUserId(userId.toString(), submissionId, "error", { message: "Problem Not Found" });
      res.status(404).json({ message: "Problem Not Found." });
    });
});

module.exports = router;
