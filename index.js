const express = require('express');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const http = require('http');
const socketIo = require('socket.io');
const yaml = require('js-yaml');
const fs   = require('fs');
const Logger = require('./Logger.js');

const appWeb = express();
const appFne = express();

const server = http.createServer(appWeb);
const io = socketIo(server);

let commandArgs = process.argv
let configPath;

/*
    Command line arg handler
 */

if (commandArgs[2] === '-c'){
    if (commandArgs[3]) {
        configPath = commandArgs[3];
    } else {
        throw Error ("Must actually give a file with the -c argument");
    }
} else {
    throw Error ("No config file specified");
}

/*
    Global config variables
 */

let webPort;
let webAddress;
let fnePort;
let fneAddress;
let logLevel;
let logPath;
let ignoreAdjBcast;
let debug;
let config;

try {
    config = yaml.load(fs.readFileSync(configPath, 'utf8'));
    webPort = config.webServer.port;
    webAddress = config.webServer.address;
    fnePort = config.fne.port;
    fneAddress = config.fne.address;
    logLevel = config.general.logLevel;
    logPath = config.general.logPath;
    debug = config.general.debug;
} catch (e) {
    throw Error (e);
}

/*
    New instance of the logger module
 */

const logger = new Logger(
    logLevel,
    logPath,
    debug
);

logger.info(`
    Web Port: ${webPort}
    Web Address: ${webAddress}
    FNE Port: ${fnePort}
    FNE Address: ${fneAddress}
    Log Level: ${logLevel}
    Log Path: ${logPath}
    Debug: ${debug}
`);

appFne.use(bodyParser.json());

appWeb.set('view engine', 'ejs');

/*
    Global variables for FNE info.
 */
//TODO: Move to a real DB
let fneReports = [];
let fneAffs = [];
let fnePeers = {peers:'[{"PeerID":"None","Identity":"None", "EndPoint": "None", "RxFrequency":"None","TxFrequency":"None"}]'};
let tgTable = {
    ActiveTGIDs: '[]',
    DeactiveTGIDs: '[]',
    AllowAffTGIDs: '[]'
}

/*
    Listener and handler for FNE2 reporter reports
 */

appFne.post('/', (req, res) => {
    logger.debug(JSON.stringify(req.body));

    let ActiveTGIDJson;
    if (req.body.ActiveTGIDs !== undefined) {
        ActiveTGIDJson = JSON.parse(req.body.ActiveTGIDs);
    }

    if (req.body.peers) {
        if (!req.body || !req.body.peers) {
            fnePeers = {peers: '[{"PeerID":"None","Identity":"None", "EndPoint": "None", "RxFrequency":"None","TxFrequency":"None"}]'};
        } else {
            fnePeers = req.body;
            io.emit('newPeerReport', fnePeers);
        }
    } else if(Array.isArray(ActiveTGIDJson)){
        logger.debug(JSON.stringify(req.body))
        tgTable = req.body;
        io.emit('updateRoutingRules', tgTable);
    } else if (req.body.Value === "UPDATE_GROUP_AFF") {
        logger.debug("Sending updated aff list");
        fneAffs = req.body;
        io.emit('newAffsReport', fneAffs);
    }else {
        if (req.body.Value !== "TSBK_OSP_ADJ_STS_BCAST" && !ignoreAdjBcast) {
            io.emit('newReport', req.body);
            fneReports.push(req.body);
        } else {
            logger.debug("Ignore adjacent site broadcast");
        }
    }

    res.status(200).send('report ack');
});

/*
    Web routes
 */

appWeb.get('/', (req, res) => {
    res.render('index', { });
});

appWeb.get('/reports', (req, res) => {
    res.render('reports', { reports: fneReports.reverse() });
});

appWeb.get('/affs', (req, res) => {
    res.render('aff', { reports: fneAffs });
});

appWeb.get('/peers', (req, res) => {
    res.render('peer', { peers: fnePeers });
});

appWeb.get('/tg_table', (req, res) => {
    res.render('tg_table', { reportData: tgTable });
});

/*
    Finally, start the main servers
 */

appFne.listen(fnePort, fneAddress, () => {
    logger.info(`FNE Listener started on http://${fneAddress}:${fnePort}`);
});
server.listen(webPort, webAddress, () => {
    logger.info(`Web server started on http://${webAddress}:${webPort}`);
});
