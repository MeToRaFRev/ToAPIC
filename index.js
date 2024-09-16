const { ApiManagementClient } = require("@azure/arm-apimanagement");
const { ClientSecretCredential } = require("@azure/identity");
const axios = require('axios');
const fs = require('fs');
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;  // Ignore SSL certificate errors
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;
const env = argv.env || 'test';
console.log(`Environment: ${env}`);
const envFilePath = env === 'prod' ? '.env.prod' : '.env.test';
require('dotenv').config({ path: envFilePath });
let subscriptionId, resourceGroupName;
let serviceName = argv.serviceName || 'datos';
switch (serviceName) {
    case 'datos':
        subscriptionId = process.env["APIMANAGEMENT_SUBSCRIPTION_ID"]
        resourceGroupName = process.env["APIMANAGEMENT_RESOURCE_GROUP"]
        serviceName = process.env["APIMANAGEMENT_SERVICE_NAME"]
        break;
}
const apiConnectBaseUrl = process.env["API_CONNECT_BASE_URL"]
const apiConnectOrgName = process.env["API_CONNECT_ORG_NAME"]

function ensureDirectoryExistence(filePath) {
    if (fs.existsSync(filePath)) {
        return true;
    }
    try {
        fs.mkdirSync(filePath, { recursive: true });
    } catch (err) {
        console.log({ err })
    }
}

async function getAPI(client, apiId, version, apiType = undefined) {
    const format = version === 'v3' ? 'openapi+json-link' : 'swagger-link ';
    // const format = version === 'v3' ? 'openapi+json-link' : apiType === 'soap' ? 'wsdl-link' : 'swagger-link';
    console.log(`Exporting API: ${apiId}`);
    const result = await client.apiExport.get(
        resourceGroupName,
        serviceName,
        apiId,
        format,
        exportParam = "true"
    );
    const swaggerUrl = result.properties.value.link;
    return swaggerUrl;
}




let tokenCache = {
    token: null,
    expiresAt: null
};
async function APIConnectAuthToken() {
    try {
        // Check if token is in cache and not expired
        if (tokenCache.token && tokenCache.expiresAt && new Date() < tokenCache.expiresAt) {
            return tokenCache.token;
        }

        // Token is expired or not available, fetch a new one
        const response = await axios.post(`${apiConnectBaseUrl}/api/token`, {
            grant_type: 'password',
            username: process.env["API_CONNECT_USERNAME"],
            password: process.env["API_CONNECT_PASSWORD"],
            realm: process.env["API_CONNECT_REALM"],
            client_id: process.env["API_CONNECT_CLIENT_ID"],
            client_secret: process.env["API_CONNECT_CLIENT_SECRET"]
        });

        if (!response.status.toString().startsWith('2')) {
            throw new Error(`${response.status} ${response.statusText}`);
        }

        // Store the token and its expiration time in the cache
        tokenCache.token = response.data.access_token;
        tokenCache.expiresAt = new Date(new Date().getTime() + (response.data.expires_in * 1000)); // Calculate expiration time

        return tokenCache.token;
    } catch (error) {
        console.error(`Error getting API Connect Auth Token:`, error.message);
    }
}

async function importToAPIConnect(swaggerContent) {
    const { title, version } = swaggerContent.info

    try {
        const response = await axios.post(`${apiConnectBaseUrl}/api/orgs/${apiConnectOrgName}/drafts/draft-apis`, swaggerContent, {
            headers: {
                'Authorization': `Bearer ${await APIConnectAuthToken()}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.status.toString().startsWith('2'))
            throw new Error(`${response.status} ${response.statusText}`);
        console.log(`Successfully imported API: ${title}:${version} to IBM API Connect`);
    } catch (error) {
        console.error(`Error importing API ${title}:${version} to IBM API Connect:`, error.message);
    }
}
// Swaggers has environment specific folders then project folders and then the actual swaggers
const folders = fs.readdirSync('swaggers');
for (const folder of folders) {
    const folderPath = `swaggers/${folder}`;
    if (!fs.lstatSync(folderPath).isDirectory()) continue;
    if(folder !== 'test') continue;
    console.log(`Processing folder: ${folder}`);
    const projectFolders = fs.readdirSync(folderPath);
    for (const projectFolder of projectFolders) {
        const projectFolderPath = `${folderPath}/${projectFolder}`;
        if (!fs.lstatSync(projectFolderPath).isDirectory()) continue;
        console.log(`Processing project folder: ${projectFolder}`);
        const swaggers = fs.readdirSync(projectFolderPath);
        for (const swagger of swaggers) {
            const swaggerPath = `${projectFolderPath}/${swagger}`;
            if (!fs.lstatSync(swaggerPath).isFile()) continue;
            console.log(`Processing swagger file: ${swagger}`);
            const swaggerContent = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
            importToAPIConnect(swaggerContent);
        }
    }
}