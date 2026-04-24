const shell = require("shelljs");
const async = require("async");
const fs = require("fs");
const path = require("path");
const { default: PQueue } = require("p-queue");
const queue = new PQueue({ concurrency: 1 });

let PATH_INIT = path.join("/app", "/submissions/");

const execute = function (
  language,
  problem,
  filename,
  testfileName,
  outputfileName,
  timeMemoryfileName,
  workDir
) {
  const timeLimit = problem.time || 5;
  const memLimit = problem.memory || 256;
  
  let compileCmd = "";
  let runCmd = "";
  let executable = "";
  
  if (language === "c") {
    executable = path.join(workDir, "solution");
    compileCmd = `gcc -o "${executable}" "${filename}" 2>&1`;
    runCmd = `cd "${workDir}" && cat "${testfileName}" | /usr/bin/env time -f "%e %M" -o "${timeMemoryfileName}" timeout ${timeLimit}s "${executable}" 2>&1`;
  } else if (language === "cpp") {
    executable = path.join(workDir, "solution");
    compileCmd = `g++ -o "${executable}" "${filename}" 2>&1`;
    runCmd = `cd "${workDir}" && cat "${testfileName}" | /usr/bin/env time -f "%e %M" -o "${timeMemoryfileName}" timeout ${timeLimit}s "${executable}" 2>&1`;
  } else if (language === "java") {
    compileCmd = `cd "${workDir}" && javac "${filename}" 2>&1`;
    runCmd = `cd "${workDir}" && cat "${testfileName}" | /usr/bin/env time -f "%e %M" -o "${timeMemoryfileName}" timeout ${timeLimit}s java solution 2>&1`;
  } else if (language === "py") {
    runCmd = `cd "${workDir}" && cat "${testfileName}" | /usr/bin/env time -f "%e %M" -o "${timeMemoryfileName}" timeout ${timeLimit}s python3 "${filename}" 2>&1`;
  }
  
  return { compileCmd, runCmd, executable };
};

const test = function (problem, submission, op, callback, progressCallback) {
  const PATH = path.join(PATH_INIT, submission._id.toString(), "/");
  const code = submission.code;
  const filename = PATH + "solution." + submission.language;
  const testfileName = PATH + "testcase.txt";
  const outputfileName = PATH + "output.txt";
  const timeMemoryfileName = PATH + "timeMemory.txt";
  let allTestcases = [];

  if (op === "runcode") allTestcases = [...problem.sampleTestcases];
  else allTestcases = [...problem.sampleTestcases, ...problem.systemTestcases];

  let result = [];
  let totalTestcases = allTestcases.length;
  let currentTestcase = 0;
  let hasCompileError = false;

  // 通知开始判题
  if (progressCallback) {
    progressCallback("starting", { 
      totalTestcases, 
      operation: op 
    });
  }

  async.waterfall([
    function (next) {
      if (progressCallback) {
        progressCallback("preparing", {});
      }
      fs.mkdir(PATH.slice(0, -1), (err) => {
        if (err) next(null, err);
        else next(null, null);
      });
    },
    function (err, next) {
      if (err) next(null, err);
      fs.closeSync(fs.openSync(outputfileName, "w"));
      fs.closeSync(fs.openSync(timeMemoryfileName, "w"));
      fs.closeSync(fs.openSync(filename, "w"));
      fs.closeSync(fs.openSync(testfileName, "w"));
      next(null, null);
    },
    function (err, next) {
      if (err) next(null, err);
      fs.writeFile(filename, code, (err) => {
        if (err) console.log(err);
        next(null, null);
      });
    },
    function (err, next) {
      if (err) next(null, err);
      
      // 通知开始编译（只对需要编译的语言）
      const needsCompile = submission.language !== "py";
      if (needsCompile && progressCallback) {
        progressCallback("compiling", {});
      }
      
      async.forEachLimit(
        allTestcases,
        1,
        function (curTestcase, cb) {
          currentTestcase++;
          
          // 如果已经有编译错误，跳过后续测试用例
          if (hasCompileError) {
            cb();
            return;
          }
          
          async.waterfall([
            function (next) {
              if (err) next(null, err);
              fs.writeFile(testfileName, curTestcase.input, (err) => {
                if (err) console.log(err);
                next(null, null);
              });
            },
            function (err, next) {
              if (err) next(null, err);
              
              // 通知正在运行测试用例
              if (progressCallback) {
                progressCallback("running", {
                  currentTestcase,
                  totalTestcases,
                  testcaseIndex: currentTestcase - 1
                });
              }
              
              const { compileCmd, runCmd } = execute(
                submission.language,
                problem,
                filename,
                testfileName,
                outputfileName,
                timeMemoryfileName,
                PATH
              );
              
              fs.writeFileSync(outputfileName, "");
              fs.writeFileSync(timeMemoryfileName, "");
              
              if (compileCmd) {
                shell.exec(compileCmd, { silent: true }, function (code, stdout, stderr) {
                  if (code !== 0) {
                    fs.writeFileSync(outputfileName, "COMPILATION ERROR\n" + stdout + stderr);
                    hasCompileError = true;
                    
                    // 通知编译错误
                    if (progressCallback) {
                      progressCallback("compile_error", {
                        error: stdout + stderr
                      });
                    }
                    
                    next(null, null);
                  } else {
                    shell.exec(runCmd, { silent: true }, function (runCode, runStdout, runStderr) {
                      const output = runStdout + runStderr;
                      if (output) {
                        fs.appendFileSync(outputfileName, output);
                      }
                      if (runCode === 124) {
                        fs.appendFileSync(outputfileName, "\nTLE");
                      } else if (runCode !== 0 && runCode !== 124) {
                        fs.appendFileSync(outputfileName, "\nRUNTIME ERROR");
                      }
                      next(null, null);
                    });
                  }
                });
              } else {
                shell.exec(runCmd, { silent: true }, function (runCode, runStdout, runStderr) {
                  const output = runStdout + runStderr;
                  if (output) {
                    fs.appendFileSync(outputfileName, output);
                  }
                  if (runCode === 124) {
                    fs.appendFileSync(outputfileName, "\nTLE");
                  } else if (runCode !== 0 && runCode !== 124) {
                    fs.appendFileSync(outputfileName, "\nRUNTIME ERROR");
                  }
                  next(null, null);
                });
              }
            },
            function (err, next) {
              if (err) next(null, err);
              try {
                const expectedOutput = curTestcase.output.trim();

                const actualOutput = fs
                  .readFileSync(outputfileName)
                  .toString()
                  .trim();
                const timeMemoryOutput = fs
                  .readFileSync(timeMemoryfileName)
                  .toString()
                  .trim();

                let arr = timeMemoryOutput.split("\n");
                const time = arr.slice(-2)[0],
                  memory = arr.slice(-1)[0];

                let curResult = {
                  actualOutput: actualOutput,
                  time: parseFloat(time),
                  memory: parseFloat(memory),
                  CE: false,
                  RTE: false,
                  TLE: false,
                  MLE: false,
                  AC: false,
                  WA: false,
                };

                if (actualOutput.includes("COMPILATION ERROR")) {
                  curResult.CE = true;
                  curResult.time = 0;
                  curResult.memory = 0;
                } else if (actualOutput.includes("MLE")) curResult.MLE = true;
                else if (actualOutput.includes("TLE")) curResult.TLE = true;
                else if (actualOutput.includes("RUNTIME ERROR"))
                  curResult.RTE = true;
                else if (
                  op !== "customInput" &&
                  actualOutput === expectedOutput
                )
                  curResult.AC = true;
                else if (op !== "customInput") curResult.WA = true;

                result.push(curResult);
                
                // 通知测试用例完成
                if (progressCallback) {
                  progressCallback("testcase_complete", {
                    currentTestcase,
                    totalTestcases,
                    testcaseIndex: currentTestcase - 1,
                    verdict: getVerdictFromResult(curResult),
                    time: curResult.time,
                    memory: curResult.memory
                  });
                }
                
                cb();
              } catch (err) {
                callback(err, null);
              }
            },
          ]);
        },
        function (err) {
          if (err) {
            next(null, err);
          }
          next(null, null);
        }
      );
    },
    function (err) {
      if (err) callback(err, null);
      
      // 通知判题完成
      if (progressCallback) {
        progressCallback("completed", { 
          totalTestcases: result.length 
        });
      }
      
      fs.rmdir(PATH.slice(0, -1), { recursive: true }, (err) => {
        if (err) callback(err, null);
        else callback(null, result);
      });
    },
  ]);
};

// 从结果对象中获取判决结果
function getVerdictFromResult(result) {
  if (result.CE) return "CE";
  if (result.MLE) return "MLE";
  if (result.TLE) return "TLE";
  if (result.RTE) return "RTE";
  if (result.AC) return "AC";
  if (result.WA) return "WA";
  return "Unknown";
}

const addSubmission = (problem, submission, op, callback, progressCallback) => {
  queue
    .add(() => test(problem, submission, op, callback, progressCallback))
    .then(() => null)
    .catch((err) => callback(err, null));
};

module.exports = addSubmission;
