// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';
 
const functions = require('firebase-functions');
const TogglClient = require('toggl-api');
const toggl = new TogglClient({apiToken: 'ef7acf87b824051722093ff460c3183e'});
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');
const util = require('util');
 
process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements

const timeEntryDescription = 'Started by Google Assistant, dialogflow, and 7eggs';
const workspace_id = 1011542;

function renderDuration(msecs) {
    const secs = Number(msecs/1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor(secs % 3600 / 60);
    const s = Math.floor(secs % 3600 % 60);

    function singularOrPlural(num, word) {
      return num + ' ' + word + (num > 1 ? 's' : '');
    }

    let hRender = '', mRender = '', sRender = '';
    if (h > 0) { hRender = singularOrPlural(h, 'hour'); }
    if (m > 0) { mRender = singularOrPlural(m, 'minute'); }
    if (s > 0) { sRender = singularOrPlural(s, 'second'); }

    if (h > 0) { return hRender + ', ' + mRender; }
    if (m > 0) { return mRender; }
    if (s > 0) { return sRender; }
}

const togglProjects = {
  "149827194": "Supper",
  "149827208": "Breakfast",
  "149827211": "Lunch",
  "149827263": "Dinner",
  "149827271": "Snack/Drink",
  "149932116": "Cleaning"
};

function getRequestedTogglProject (project) {
  const regex = new RegExp(project, 'i'); // case-insensitive
  const [id, name] = Object.entries(togglProjects).find(([id, name]) => name.match(regex));
  return { id, name };
}

async function handleStop(conv) {
  const responses = [];

  const getCurrentTimeEntry = util.promisify(toggl.getCurrentTimeEntry.bind(toggl));
  const stopTimeEntry = util.promisify(toggl.stopTimeEntry.bind(toggl));
  const getProject = util.promisify(toggl.getProjectData.bind(toggl));
  const detailedReport = util.promisify(toggl.detailedReport.bind(toggl));

  const currentTimeEntry = await getCurrentTimeEntry().catch(console.error);
  if (!currentTimeEntry) {
    return conv.close('Can\'t stop if it ain\'t started!');
  }

  await stopTimeEntry(currentTimeEntry.id).catch(console.error);

  let stoppedProj;
  if (currentTimeEntry.pid) {
    const stoppedTimeEntryProject = await getProject(currentTimeEntry.pid).catch(console.error);
    stoppedProj = stoppedTimeEntryProject.name;
  }
  const duration = renderDuration(Date.now() + currentTimeEntry.duration * 1000) // toggl weirdness
  responses.push(`${stoppedProj || 'Running time entry'} stopped after ${duration}.`);

  const todayInYYYYMMDD = (new Date()).toISOString().split('T')[0]; // format YYYY-MM-DD
  const { total_grand: totalMsToday, total_count } = await detailedReport({ workspace_id, since: todayInYYYYMMDD }).catch(console.error);

  if (total_count > 1) {
    responses.push('Total time today: ' + renderDuration(totalMsToday));
  }

  conv.close(...responses);
}

async function handleStart(conv, project) {
  const responses = [];

  console.log(1);
  const { id: requestedProjectId, name: requestedProjectName } = getRequestedTogglProject(project);
  console.log(requestedProjectId, requestedProjectName);

  const startTimeEntry = util.promisify(toggl.startTimeEntry.bind(toggl));
  const summaryReport = util.promisify(toggl.summaryReport.bind(toggl));
  const getCurrentTimeEntry = util.promisify(toggl.getCurrentTimeEntry.bind(toggl));
  const getProject = util.promisify(toggl.getProjectData.bind(toggl));

  console.log(3);
  const currentTimeEntry = await getCurrentTimeEntry().catch(console.error);
  console.log(currentTimeEntry);
  if (currentTimeEntry) {
    console.log(5);
    const { name: currentlyTrackedProject } = await getProject(currentTimeEntry.pid).catch(console.error);
    console.log(currentlyTrackedProject);
    responses.push(`We were already tracking ${currentlyTrackedProject}.`);
    console.log(7);
  }

  console.log(8);
  await startTimeEntry({ pid: requestedProjectId, description: timeEntryDescription}).catch(console.error);
  console.log('9 started');
  responses.push(requestedProjectName + ' - started!');

  const todayInYYYYMMDD = (new Date()).toISOString().split('T')[0]; // format YYYY-MM-DD
  console.log(10);
  const { total_grand: totalMsToday } = await summaryReport({
    workspace_id,
    since: todayInYYYYMMDD
  }).catch(console.error);
  console.log(totalMsToday);

  if (totalMsToday) {
    console.log(renderDuration(totalMsToday));
    responses.push('Total time today: ' + renderDuration(totalMsToday));
  }

  conv.close(...responses);
}

exports.handleStart = handleStart;
exports.handleStop = handleStop;
exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
  const agent = new WebhookClient({ request, response });
  console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
  console.log('Dialogflow Request body: ' + JSON.stringify(request.body));
 
  function welcome(agent) {
    agent.add(`Welcome to Aligners!`);
  }
 
  function fallback(agent) {
    agent.add(`I didn't understand`);
    agent.add(`I'm sorry, can you try again?`);
  }

  async function googleAssistantStartHandler(agent) {
    let conv = agent.conv(); // Get Actions on Google library conv instance
    let project = request.body.queryResult.parameters['toggl-project']; // project is a required param

    await handleStart(conv, project);

    agent.add(conv); // Add Actions on Google library responses to your agent's response
  }

  async function googleAssistantStopHandler(agent) {
    let conv = agent.conv(); // Get Actions on Google library conv instance
    await handleStop(conv);
    agent.add(conv); // Add Actions on Google library responses to your agent's response
  }
  // See https://github.com/dialogflow/dialogflow-fulfillment-nodejs/tree/master/samples/actions-on-google
  // for a complete Dialogflow fulfillment library Actions on Google client library v2 integration sample

  // Run the proper function handler based on the matched Dialogflow intent name
  let intentMap = new Map();
  intentMap.set('Default Welcome Intent', welcome);
  intentMap.set('Default Fallback Intent', fallback);
  // intentMap.set('your intent name here', yourFunctionHandler);
  intentMap.set('Start a time entry', googleAssistantStartHandler);
  intentMap.set('Stop currently running time entry', googleAssistantStopHandler);
  agent.handleRequest(intentMap);
});
