import React, { useState, useEffect, useRef, useCallback } from "react";
import { Redirect } from 'react-router-dom';
import axios from "axios";
import { BeatLoader } from "react-spinners";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCode, faSync } from "@fortawesome/free-solid-svg-icons";
import Chip from "@material-ui/core/Chip";
import LinearProgress from "@material-ui/core/LinearProgress";
import Typography from "@material-ui/core/Typography";
import Box from "@material-ui/core/Box";

import { BACK_SERVER_URL, JUDGE_URL } from "../../config/config";
import webSocketManager from "../../websocket";

import CodeEditor from "./codeEditor/CodeEditor";
import ResultTable from "./resultTable/ResultTable";

import "./problem.css";

function LinearProgressWithLabel(props) {
  return (
    <Box display="flex" alignItems="center">
      <Box width="100%" mr={1}>
        <LinearProgress variant="determinate" {...props} />
      </Box>
      <Box minWidth={35}>
        <Typography variant="body2" color="textSecondary">{`${Math.round(
          props.value,
        )}%`}</Typography>
      </Box>
    </Box>
  );
}

const parseJwt = (token) => {
  if(token === "" || token === null) return null;
  var base64Url = token.split(".")[1];
  var base64 = base64Url.replace("-", "+").replace("_", "/");
  return JSON.parse(window.atob(base64)).sub;
};

const Problem = (props) => {
  const resultRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [problemDoesNotExists, setProblemDoesNotExists] = useState(false);
  const [problem, setProblem] = useState({});
  const [language, setLanguage] = useState("C++");
  const [darkMode, setDarkMode] = useState(false);
  const [code, setCode] = useState("");
  const [results, setResults] = useState([]);
  const [runLoading, setRunLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [currentSubmissionId, setCurrentSubmissionId] = useState(null);
  
  const [judgeProgress, setJudgeProgress] = useState({
    status: null,
    message: "",
    currentTestcase: 0,
    totalTestcases: 0,
    progress: 0,
  });

  const languageExtention = {
    C: "c",
    "C++": "cpp",
    Java: "java",
    Python: "py",
  };

  const getStatusMessage = (status, data) => {
    switch (status) {
      case "starting":
        return "开始判题...";
      case "preparing":
        return "准备环境...";
      case "compiling":
        return "编译中...";
      case "running":
        return `运行测试用例 ${data.currentTestcase}/${data.totalTestcases}...`;
      case "compile_error":
        return "编译错误";
      case "testcase_complete":
        return `测试用例 ${data.currentTestcase}/${data.totalTestcases} 完成: ${data.verdict}`;
      case "completed":
        return "判题完成";
      case "error":
        return `错误: ${data.message || "未知错误"}`;
      default:
        return "处理中...";
    }
  };

  const handleJudgeProgress = useCallback((data) => {
    if (data.submissionId !== currentSubmissionId) {
      return;
    }

    const { status, ...rest } = data;
    const message = getStatusMessage(status, rest);
    
    let progress = judgeProgress.progress;
    if (status === "starting") {
      progress = 10;
    } else if (status === "preparing") {
      progress = 20;
    } else if (status === "compiling") {
      progress = 30;
    } else if (status === "running" || status === "testcase_complete") {
      const current = rest.currentTestcase || 0;
      const total = rest.totalTestcases || 1;
      progress = 30 + (current / total) * 60;
    } else if (status === "completed") {
      progress = 100;
    }

    setJudgeProgress({
      status,
      message,
      currentTestcase: rest.currentTestcase || 0,
      totalTestcases: rest.totalTestcases || 0,
      progress: Math.min(progress, 100),
    });
  }, [currentSubmissionId, judgeProgress.progress]);

  const handleJudgeResult = useCallback((data) => {
    if (data.submissionId !== currentSubmissionId) {
      return;
    }

    console.log("Received judge result via WebSocket:", data);
    
    setResults(data.result);
    setJudgeProgress({
      status: "completed",
      message: `判题完成: ${data.verdict}`,
      currentTestcase: data.result.length,
      totalTestcases: data.result.length,
      progress: 100,
    });

    setRunLoading(false);
    setSubmitLoading(false);

    const accessToken = localStorage.getItem("access-token");
    const userId = parseJwt(accessToken);
    
    if (userId) {
      axios
        .post(
          `${BACK_SERVER_URL}/api/submission`,
          {
            problemName: problem.name,
            code,
            language: languageExtention[language],
            userId,
            verdict: data.verdict,
            result: data.result,
          },
          { headers: {"Authorization" : `Bearer ${accessToken}`} }
        )
        .then(() => {})
        .catch((err) => {
          const error = err.response
            ? err.response.data.message
            : err.message;
          toast.error(error, {
            position: "top-right",
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            progress: undefined,
          });
        });
    }

    if (resultRef.current) {
      resultRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "start",
      });
    }
  }, [currentSubmissionId, problem.name, code, language, languageExtention]);

  useEffect(() => {
    const problemId = props.match.params.id;

    axios
      .get(`${BACK_SERVER_URL}/api/problem/${problemId}`)
      .then((res) => {
        if (!res.data || res.data.length === 0) setProblemDoesNotExists(true);
        else {
          setProblem(res.data);
        }
        setLoading(false);
      })
      .catch((err) => {
        setLoading(false);
        setProblemDoesNotExists(true);
        const error = err.response ? err.response.data.message : err.message;
        toast.error(error, {
          position: "top-right",
          autoClose: 5000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
        });
      });

    webSocketManager.connect();
    webSocketManager.on("judge_progress", handleJudgeProgress);
    webSocketManager.on("judge_result", handleJudgeResult);

    return () => {
      webSocketManager.off("judge_progress", handleJudgeProgress);
      webSocketManager.off("judge_result", handleJudgeResult);
    };
  }, [props.match.params.id, handleJudgeProgress, handleJudgeResult]);

  const handleLanguageSelect = (e) => {
    e.preventDefault();
    setLanguage(e.target.value);
  };

  const handleModeChange = (themeMode) => {
    setDarkMode(themeMode);
  };

  const onCodeChange = (newValue) => {
    setCode(newValue);
  };

  const submit = (e) => {
    e.preventDefault();
    const operation = e.currentTarget.value.toString();
    
    if (operation === "runcode") {
      setRunLoading(true);
    } else {
      setSubmitLoading(true);
    }

    setResults([]);
    setJudgeProgress({
      status: null,
      message: "提交中...",
      currentTestcase: 0,
      totalTestcases: 0,
      progress: 0,
    });

    const accessToken = localStorage.getItem("access-token");
    const userId = parseJwt(accessToken);
    
    axios
      .post(`${JUDGE_URL}/api/evaluate`, {
        problemId: problem.id,
        problemName: problem.name,
        code: code,
        language: languageExtention[language],
        operation: operation,
      }, { headers: {"Authorization" : `Bearer ${accessToken}`} })
      .then((res) => {
        const { submissionId, verdict, result, pushedViaWebSocket } = res.data;
        
        if (submissionId) {
          setCurrentSubmissionId(submissionId);
          webSocketManager.registerSubmission(submissionId, problem.id);
        }

        if (!pushedViaWebSocket) {
          console.log("WebSocket push failed, using HTTP response");
          
          setResults(result);
          setJudgeProgress({
            status: "completed",
            message: `判题完成: ${verdict}`,
            currentTestcase: result.length,
            totalTestcases: result.length,
            progress: 100,
          });

          setRunLoading(false);
          setSubmitLoading(false);

          if (operation !== "runcode" && userId) {
            axios
              .post(
                `${BACK_SERVER_URL}/api/submission`,
                {
                  problemName: problem.name,
                  code,
                  language: languageExtention[language],
                  userId,
                  verdict: verdict,
                  result: result,
                },
                { headers: {"Authorization" : `Bearer ${accessToken}`} }
              )
              .then(() => {})
              .catch((err) => {
                const error = err.response
                  ? err.response.data.message
                  : err.message;
                toast.error(error, {
                  position: "top-right",
                  autoClose: 5000,
                  hideProgressBar: false,
                  closeOnClick: true,
                  pauseOnHover: true,
                  draggable: true,
                  progress: undefined,
                });
              });
          }

          if (resultRef.current) {
            resultRef.current.scrollIntoView({
              behavior: "smooth",
              block: "start",
              inline: "start",
            });
          }
        }
      })
      .catch((err) => {
        setRunLoading(false);
        setSubmitLoading(false);
        setJudgeProgress({
          status: "error",
          message: "提交失败",
          currentTestcase: 0,
          totalTestcases: 0,
          progress: 0,
        });
        
        const error = err.response ? err.response.data.message : err.message;
        toast.error(error, {
          position: "top-right",
          autoClose: 5000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
        });
      });
  };

  const showProgress = runLoading || submitLoading;

  return problemDoesNotExists ? (
    <>
      <Redirect to="/nocontent" />
    </>
  ) : loading ? (
    <div className="problem-loading-spinner">
      <BeatLoader color={"#343a40"} size={30} loading={loading} />
    </div>
  ) : (
    <div>
      <div className="problem-container">
        <ToastContainer />
        <div className="problem-title-wrapper">
          <div className="problem-title">
            <FontAwesomeIcon
              title="Happy Coding!"
              className="problem-code-icon"
              icon={faCode}
            />
            {problem.name}
          </div>
          <div className="problem-details">
            <div className="problem-details-item">
              <Chip
                label={"Time: " + problem.time + "s"}
                variant="outlined"
                color="primary"
                style={{ fontWeight: "600", fontSize: "medium" }}
              />
            </div>
            <div className="problem-details-item">
              <Chip
                label={"Memory: " + problem.memory + "MB"}
                variant="outlined"
                color="primary"
                style={{ fontWeight: "600", fontSize: "medium" }}
              />
            </div>
          </div>
        </div>
        <div className="problem-statement-wrapper">
          <div
            className="problem-statement"
            dangerouslySetInnerHTML={{
              __html: problem.statement
                ? problem.statement.replace(/<br>/g, " ")
                : null,
            }}
          />
        </div>
        <div className="problem-sample-test-wrapper">
          {problem.sampleTestcases &&
            problem.sampleTestcases.map((testcase, index) => (
              <div className="problem-sample-test" key={index}>
                <div className="problem-sample-test-input">
                  <span className="problem-sample-test-input-title">
                    Sample Input {index + 1}
                  </span>
                  <pre className="problem-sample-test-input-content">
                    {testcase.input}
                  </pre>
                </div>
                <div className="problem-sample-test-output">
                  <span className="problem-sample-test-output-title">
                    Sample Output {index + 1}
                  </span>
                  <pre className="problem-sample-test-output-content">
                    {testcase.output}
                  </pre>
                </div>
              </div>
            ))}
          {problem.explanation ? (
            <div className="problem-sample-test-explanation">
              <span className="problem-sample-test-explanation-title">
                Explanation :{" "}
              </span>
              <div className="problem-sample-test-explanation-content">
                {problem.explanation}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {showProgress && (
        <div className="judge-progress-container">
          <div className="judge-progress-header">
            <FontAwesomeIcon icon={faSync} spin className="progress-icon" />
            <span className="progress-status">{judgeProgress.message}</span>
          </div>
          <LinearProgressWithLabel value={judgeProgress.progress} />
          {judgeProgress.totalTestcases > 0 && (
            <div className="progress-details">
              测试用例: {judgeProgress.currentTestcase} / {judgeProgress.totalTestcases}
            </div>
          )}
        </div>
      )}

      <CodeEditor
        language={language}
        handleLanguageSelect={handleLanguageSelect}
        darkMode={darkMode}
        handleModeChange={handleModeChange}
        onCodeChange={onCodeChange}
        submit={submit}
        runLoading={runLoading}
        submitLoading={submitLoading}
      />
      <ResultTable results={results} resultRef={resultRef} />
      <br />
      <br />
    </div>
  );
};

export default Problem;
