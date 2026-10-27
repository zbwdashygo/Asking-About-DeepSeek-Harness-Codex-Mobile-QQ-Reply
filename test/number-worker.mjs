import { allocateQuestionNumber } from '../app/bridge/question-numbers.mjs';
const numbers=[];for(let i=0;i<12;i++)numbers.push(await allocateQuestionNumber(process.argv[2]));process.stdout.write(JSON.stringify(numbers));
