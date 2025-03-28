/*global $ -- jquery is externally imported*/
/*global FEEDBACK_SURVEY_URL -- is set by environment variable*/
/*global Metro -- Metro is externally imported*/

import * as ace from 'ace-builds/src-min-noconflict/ace';
import 'ace-builds/src-min-noconflict/theme-eclipse';
import 'ace-builds/src-min-noconflict/mode-xml';
import 'ace-builds/src-min-noconflict/mode-yaml';
import 'ace-builds/src-min-noconflict/mode-java';
import 'ace-builds/src-min-noconflict/mode-html';
import 'ace-builds/src-min-noconflict/ext-modelist';
import 'ace-builds/src-min-noconflict/ext-language_tools';

import 'metro4/build/metro';

import * as Diff from 'diff';

import { FileHandler } from './FileHandler.js';
import { ActivityManager } from './ActivityManager.js';
import { ToolManager as ToolsManager } from './ToolsManager.js';
import { EducationPlatformError } from './EducationPlatformError.js'
import { ConfigValidationError } from './ConfigValidationError.js';
import { ActivityValidator } from './ActivityValidator.js';

import { ConsolePanel } from "./ConsolePanel.js";
import { ProgramPanel } from "./ProgramPanel.js";
import { OutputPanel } from "./OutputPanel.js";
import { TestPanel } from './TestPanel.js';
import { BlankPanel } from './BlankPanel .js';
import { XtextEditorPanel } from './XtextEditorPanel.js';
import { CompositePanel } from './CompositePanel.js';
import { SaveablePanel } from './SaveablePanel.js';
import { Button } from './Button.js';

import { Preloader } from './Preloader.js';
import { Layout, PANEL_HOLDER_ID } from './Layout.js';
import { PlaygroundUtility } from './PlaygroundUtility.js';
import { jsonRequest, urlParamPrivateRepo, utility, getRequest, setAuthenticated } from './Utility.js';
import { ErrorHandler } from './ErrorHandler.js';


const COMMON_UTILITY_URL = utility.getWindowLocationHref().replace( utility.getWindowLocationSearch(), "" ) + "common/utility.json";
const ACTION_FUNCTION_LANGUAGE_TYPE = "text";
const DEFAULT_COMMIT_MESSAGE = "MDENet Education Platform save.";

class EducationPlatformApp {
    outputType;
    outputLanguage;
    activity;
    preloader;
    panels;
    saveablePanels;
    branches;
    activityURL;
    confirmLeavePage;

    errorHandler;
    fileHandler;
    activityManager;
    toolsManager;
    wsUri

    constructor() {
        this.outputType = "text";
        this.outputLanguage = "text";
        this.errorHandler = new ErrorHandler();
        this.preloader = new Preloader();
        this.panels = [];
        this.saveablePanels = [];
        this.branches = [];
        this.confirmLeavePage = false;
    }

    initialize( urlParameters, tokenHandlerUrl , wsUri){
        this.fileHandler = new FileHandler(tokenHandlerUrl);
        this.wsUri = wsUri;
        setAuthenticated(false);

        /* 
        *  Setup the browser environment 
        */
        if (FEEDBACK_SURVEY_URL){
            PlaygroundUtility.setFeedbackButtonUrl(FEEDBACK_SURVEY_URL);
            PlaygroundUtility.showFeedbackButton();
        }

        // Check if returning from an authentication redirect
        if (urlParameters.has("code") && urlParameters.has("state")) {
            // Returning from authentication redirect
            this.handleAuthRedirect(urlParameters, tokenHandlerUrl);
        }
        else {
            this.handleInitialLoad(urlParameters, tokenHandlerUrl);
        }

        document.getElementById("btnnologin").onclick = async () => {
            setAuthenticated(false);
            PlaygroundUtility.hideLogin();
        }

        document.getElementById("btnlogin").onclick = async () => {

            // Get github url
            const urlRequest = { url: utility.getWindowLocationHref() };
            let authServerDetails = await jsonRequest(tokenHandlerUrl + "/mdenet-auth/login/url",
                                                    JSON.stringify(urlRequest) );

            authServerDetails = JSON.parse(authServerDetails);

            // Authentication redirect
            utility.setWindowLocationHref(authServerDetails.url);
        }

        // Clean authentication parameters from url
        this.cleanAuthParams(urlParameters);
    }

    async handleAuthRedirect(urlParameters, tokenHandlerUrl) {
        PlaygroundUtility.hideLogin();

        // Complete authentication
        const tokenRequest = {};
        tokenRequest.state = urlParameters.get("state");
        tokenRequest.code = urlParameters.get("code");

        try {
            //TODO loading box
            const authDetails = await jsonRequest(tokenHandlerUrl + "/mdenet-auth/login/token",
                JSON.stringify(tokenRequest), true );
            
            this.setupAuthenticatedState(urlParameters);
        }
        catch (error) {
            console.error("Error while completing authentication:", error);
            PlaygroundUtility.showLogin();
        }
    }

    async handleInitialLoad(urlParameters, tokenHandlerUrl) {
        try {
            // Check if there is a valid authentication cookie, if there is then skip login process
            let hasAuthCookie = await getRequest(tokenHandlerUrl + "/mdenet-auth/login/validate", true);
            hasAuthCookie = JSON.parse(hasAuthCookie);

            if (hasAuthCookie.authenticated) {
                console.log("User has previously logged in - redirecting to activity.");

                PlaygroundUtility.hideLogin();
                this.setupAuthenticatedState(urlParameters);
            } 
            else {
                console.log("User is not authenticated - showing login.");
                PlaygroundUtility.showLogin();
            }
        }
        catch (error) {
            console.error("Error while checking authentication cookie:", error);
            PlaygroundUtility.showLogin();
        }
    }
    
    cleanAuthParams(urlParameters) {
        urlParameters.delete("code");
        urlParameters.delete("state");

        // Encode ':' and '/' with toString
        // Skips the default encoding to so that the URL can be reused
        let params = [];
        for (const [key, value] of urlParameters) {
            // For a specific key ('activities' in this case), you add it to the array without encoding
            if (key === 'activities') {
                params.push(`${key}=${value}`);
            } 
            else {
                // For all other parameters, you still want to encode them
                params.push(`${key}=${encodeURIComponent(value)}`);
            }
        }
        // Now join all the parameters with '&' to form the query string
        let queryString = params.join('&');

        // Use replaceState to update the URL without encoding the parameter
        window.history.replaceState({}, document.title, "?" + queryString);
    }

    /**
     * Set up the environment for an authenticated user
     * @param {URLSearchParams} urlParameters - The URL parameters.
     */
    setupAuthenticatedState(urlParameters) {
        document.getElementById('save')?.classList.remove('hidden');
        document.getElementById('branch')?.classList.remove('hidden');
        document.getElementById('review-changes')?.classList.remove('hidden');

        setAuthenticated(true);
        this.activityURL = utility.getActivityURL();
        this.initializeActivity(urlParameters);

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Warn user if there are unsaved changes before closing the tab
        window.addEventListener("beforeunload", (event) => {
            if (this.changesHaveBeenMade() && !this.confirmLeavePage) {
                event.preventDefault();

                // Browsers usually ignore the message
                // return "You have unsaved changes. Are you sure you want to leave?";
            }
        });
    }

    initializeActivity(urlParameters){

        let errors = [];

        if (!urlParameters.has("activities")) {
            // No activity configuration has been given
            errors.push(new EducationPlatformError("No activity configuration has been specified."));
        }

        if (errors.length==0){
            // An activity configuration has been provided
            this.toolsManager = new ToolsManager(this.errorHandler.notify.bind(this.errorHandler));
            this.activityManager = new ActivityManager( (this.toolsManager.getPanelDefinition).bind(this.toolsManager), this.fileHandler );
            this.activityManager.initializeActivities();
            errors = errors.concat(this.activityManager.getConfigErrors());
        } 

        if (errors.length==0){
            // The activities have been validated
            this.toolsManager.setToolsUrls( this.activityManager.getToolUrls().add(COMMON_UTILITY_URL) );
            errors = errors.concat(this.toolsManager.getConfigErrors());
        }

        if (errors.length==0){
            // The tools have been validated 
            this.activityManager.showActivitiesNavEntries();

            // Import tool grammar highlighting 
            const  toolImports = this.toolsManager.getToolsGrammarImports(); 

            for(let ipt of toolImports) {
                ace.config.setModuleUrl(ipt.module, ipt.url);
            }

            // Add Tool styles for icons 
           for (let toolUrl of this.toolsManager.toolsUrls){
                let toolBaseUrl = toolUrl.url.substring(0, toolUrl.url.lastIndexOf("/"));
                var link = document.createElement("link");
                link.setAttribute("rel", 'stylesheet');
                link.setAttribute("href", toolBaseUrl + "/icons.css");
                document.head.appendChild(link);
            }
            
            this.activity = this.activityManager.getSelectedActivity(); 

            // Validate the resolved activity
            errors = errors.concat( ActivityValidator.validate(this.activity, this.toolsManager.tools) );   
        }

        if  (errors.length==0){
            // The resolved activity has been validated
            this.initializePanels();
        }

        if (errors.length > 0) {
            this.displayErrors(errors);
        }
    }

    displayErrors(errors){

            const contentPanelName = "content-panel";
        
            this.panels.push(new BlankPanel(contentPanelName));
            this.panels[0].setVisible(true);
        
            new Layout().createFromPanels("navview-content", this.panels);
        
            PlaygroundUtility.showMenu();
        
            Metro.init();
            this.fit();
        
            var contentPanelDiv = document.getElementById(contentPanelName);

            // EP Errors
            const platformErrors= errors.filter((e)=> e.constructor.name === EducationPlatformError.name);

            if (platformErrors.length > 0){
                let contentTitle = document.createElement("h2");
                contentTitle.innerText = "Education Platform Errors:";
                contentPanelDiv.append(contentTitle);

                platformErrors.forEach( (err) => {
                    let content = document.createElement("p");
                    content.append(document.createTextNode(err.message));

                    contentPanelDiv.append(content);
                });

                contentPanelDiv.append(document.createElement("p"));
            }

            // Config File Errors
            const configErrors= errors.filter((e)=> e.constructor.name === ConfigValidationError.name);

            if(configErrors.length > 0){
                let contentTitle = document.createElement("h2");
                contentTitle.innerText = "Config File Errors:";
                contentPanelDiv.append(contentTitle);

                let contentLabels = document.createElement("b");
                contentLabels.innerText = "File | Category | Details | Location";
                contentPanelDiv.append(contentLabels);

                configErrors.forEach( (err) => {
                    let content = document.createElement("p");
                    let contentText= `${err.fileType} | ${err.category} | ${err.message} | ${err.location}` ;
                    content.append(document.createTextNode(contentText));

                    contentPanelDiv.append(content);
                });
            }

            const otherErrors = errors.filter((e) => !(configErrors.includes(e) || platformErrors.includes(e)))
            if (otherErrors.length > 0) {
                let contentTitle = document.createElement("h2");
                contentTitle.innerText = "Errors:";
                contentPanelDiv.append(contentTitle);

                otherErrors.forEach( (err) => {
                    let content = document.createElement("p");
                    let contentText= `${err.constructor.name}: ${err.message}` ;
                    content.append(document.createTextNode(contentText));

                    contentPanelDiv.append(content);
                });
            }
    }

    initializePanels() {
        
        if (this.activity.outputLanguage != null) {
            this.outputLanguage = this.activity.outputLanguage;
        }
        
        // Create panels for the given activities
        for ( let apanel of this.activity.panels ){

            var newPanel = this.createPanelForDefinitionId(apanel);
            if (newPanel != null){
                this.panels.push(newPanel);
            }
        }
        this.saveablePanels = this.getSaveablePanels(this.panels);

        new Layout().createFrom2dArray("navview-content", this.panels, this.activity.layout.area);

        PlaygroundUtility.showMenu();
        
        document.addEventListener('click', function(evt) {
            if (evt.target == document.getElementById("toggleNavViewPane")) {
                setTimeout(function(){ this.fit(); }, 1000);
            }
        });

        Metro.init();

        this.activityManager.openActiveActivitiesSubMenu();
        
        this.fit();
    }


    /**
     * Create a panel for a given panel config entry
     * 
     * @param {Object} panel - The activity config panel definition.
     * @return {Panel} the platform Panel
     */
    createPanelForDefinitionId(panel){
        const panelDefinition = panel.ref;
        var newPanel = null;

        const newPanelId = panel.id;

        if (panelDefinition != null){

            switch(panelDefinition.panelclass) {
                case "ProgramPanel": {
                    newPanel =  new ProgramPanel(newPanelId);
                    newPanel.initialize();
                    
                    // Set from the tool panel definition  
                    newPanel.setEditorMode(panelDefinition.language);
                    newPanel.setType(panelDefinition.language);

                    // Set from the activity 
                    newPanel.setValue(panel.file);
                    newPanel.setLastSavedContent(panel.file);
                    newPanel.setValueSha(panel.sha); 
                    newPanel.setFileUrl(panel.url);
                    break;
                }
                case "ConsolePanel": {
                    newPanel =  new ConsolePanel(newPanelId);
                    newPanel.initialize();
                    break;
                }
                case "OutputPanel": {
                    newPanel =  new OutputPanel(newPanelId, panelDefinition.language, this.outputType, this.outputLanguage);
                    newPanel.initialize();
                    break;
                }
                case "XtextEditorPanel": {
                    let editorUrl = sessionStorage.getItem(newPanelId);
                    
                    newPanel = new XtextEditorPanel(newPanelId);
                    newPanel.initialize(editorUrl, panel.extension);
                    newPanel.setType(panelDefinition.language);

                    // Set from the activity 
                    newPanel.setValue(panel.file);
                    newPanel.setLastSavedContent(panel.file);
                    newPanel.setValueSha(panel.sha); 
                    newPanel.setFileUrl(panel.url)
                    break;
                }
                case "CompositePanel": {

                    newPanel = new CompositePanel(newPanelId);
                    if (panel.childPanels) {
                        for (let childPanelConfig of panel.childPanels) {     
                            var childPanel = this.createPanelForDefinitionId(childPanelConfig);
                            newPanel.addPanel(childPanel);
                        }
                    }
                    newPanel.initialize();
                    
                    break;
                }
                // TODO create other panel types e.g. models and metamodels so the text is formatted correctly
                default: {
                    newPanel = new TestPanel(newPanelId);    
                }            
            }
        
            // Add elements common to all panels
            newPanel.setTitle(panel.name);
            newPanel.setName(panel.name);

            if(panel.icon != null){
                newPanel.setIcon(panel.icon);
            } else {
                newPanel.setIcon(panelDefinition.icon);
            }
            
            if (panel.buttons == null && panelDefinition.buttons != null){
                // No activity defined buttons
                newPanel.addButtons( Button.createButtons( panelDefinition.buttons, panel.id));

            } else if (panel.buttons != null) {
                // The activity has defined the buttons, some may be references to buttons defined in the tool spec
                let resolvedButtonConfigs = panel.buttons.map(btn =>{    
                    let resolvedButton;

                    if (btn.ref){
                        if (panelDefinition.buttons != null) {
                            // button reference so resolve
                            resolvedButton = panelDefinition.buttons.find((pdBtn)=> pdBtn.id===btn.ref);
                        }
                    } else {
                        // activity defined button
                        resolvedButton = btn;
                    }
                    return resolvedButton;
                });
                panel.buttons = resolvedButtonConfigs;
                newPanel.addButtons( Button.createButtons( resolvedButtonConfigs, panel.id));
            }
        }
        return newPanel;
    }


    getPanelTitle(panelId) {
        return $("#" + panelId)[0].dataset.titleCaption;
    }

   
    /**
     * Handle the response from the remote tool service
     * 
     * @param {Object} action 
     * @param {Promise} requestPromise
     */
    handleResponseActionFunction(action, requestPromise){
        
        requestPromise.then( (responseText) => {

            var response = JSON.parse(responseText);
            const outputPanel = this.activityManager.findPanel( action.output.id, this.panels);

            var outputConsole;
            if (action.outputConsole != null){
                outputConsole = this.activityManager.findPanel(action.outputConsole.id, this.panels);
            } else {
                outputConsole = outputPanel;
            }

            Metro.notify.killAll();

            if ( Object.prototype.hasOwnProperty.call(response, "error")) {
                outputConsole.setError(response.error);
            } else {

                var responseDiagram = Object.keys(response).find( key => key.toLowerCase().includes("diagram") );

                if (response.output) {
                    // Text
                    outputConsole.setValue(response.output)  
                }
                
                if (response.editorID) {
                    // Language workbench
                    PlaygroundUtility.longNotification("Building editor");

                    this.checkEditorReady(response.editorID, response.editorUrl, action.source.editorPanel, action.source.editorActivity, outputConsole);
                    

                } else if (responseDiagram != undefined) {
                
                    outputPanel.renderDiagram( response[responseDiagram] );
                    
                } else if (response.generatedFiles) {
                    // Multiple text files
                    outputPanel.setGeneratedFiles(response.generatedFiles);

                } else if (response.generatedText) {
                    // Generated file

                    switch (action.outputType){
                        case "code":
                            // Text
                            outputPanel.getEditor().setValue(response.generatedText.trim(), 1);
                            break;

                        case "html":
                            // Html
                            outputPanel.setOutput(response.output);
                            var iframe = document.getElementById("htmlIframe");
                            if (iframe == null) {
                                iframe = document.createElement("iframe");
                                iframe.id = "htmlIframe"
                                iframe.style.height = "100%";
                                iframe.style.width = "100%";
                                document.getElementById(outputPanel.getId() + "Diagram").appendChild(iframe);
                            }
                            
                            iframe.srcdoc = response.generatedText;
                            break; 

                        case "puml": 
                        case "dot":
                            // UML or Graph
                            var krokiEndpoint = "";
                            if (action.outputType == "puml") krokiEndpoint = "plantuml";
                            else krokiEndpoint = "graphviz/svg"

                            var krokiXhr = new XMLHttpRequest();
                            krokiXhr.open("POST", "https://kroki.io/" + krokiEndpoint, true);
                            krokiXhr.setRequestHeader("Accept", "image/svg+xml");
                            krokiXhr.setRequestHeader("Content-Type", "text/plain");
                            krokiXhr.onreadystatechange = function () {
                                if (krokiXhr.readyState === 4) {
                                    if (krokiXhr.status === 200) {

                                        outputPanel.renderDiagram(krokiXhr.responseText);

                                    }
                                }
                            };
                            krokiXhr.send(response.generatedText);
                            break;

                            default:
                                console.log("Unknown output type: " + action.outputType);
                    }
                }

            } 
        }).catch( (err) => {
            this.errorHandler.notify("There was an error translating action function parameter types.", err);
        });

    }


    fit() {
        var splitter = document.getElementById(PANEL_HOLDER_ID);
        if (splitter){
            splitter.style.minHeight = window.innerHeight + "px";
            splitter.style.maxHeight = window.innerHeight + "px";
        }
        this.panels.forEach(panel => panel.fit());
        this.preloader.hide();
    }


    runAction(source, sourceButton) {

        // Get the action
        var action = this.activityManager.getActionForCurrentActivity(source, sourceButton);
       
        if (!action){
            let err = new EducationPlatformError(`Cannot find action given panel '${source}' and button '${sourceButton}'`);
            this.errorHandler.notify("Failed to invoke action.", err);

        } else {
            // Action found so try and invoke
            let buttonConfig;
            
            if(action.source.buttons){
                //Buttons defined by activity
                buttonConfig = action.source.buttons.find (btn => btn.id == sourceButton);
            } else {
                //Buttons defined by tool
                buttonConfig = action.source.ref.buttons.find (btn => btn.id == sourceButton);
            }  

            // Create map containing panel values
            let parameterMap = new Map();

            for (let paramName of Object.keys(action.parameters)){

                let param = {};
                const panelId = action.parameters[paramName].id;
                
                if (panelId) { 
                    const panel = this.activityManager.findPanel(panelId, this.panels);
                    param.type = panel.getType();
                    param.value = panel.getValue();

                } else {
                    // No panel with ID so it use as the parameter value
                    const parameterValue = action.parameters[paramName];
                    param.type = 'text';
                    param.value = parameterValue;
                }

                parameterMap.set(paramName, param);
            }

            // Add the platform language parameter
            let languageParam = {};
            languageParam.type = ACTION_FUNCTION_LANGUAGE_TYPE;
            languageParam.value = action.source.ref.language; // Source panel language
            parameterMap.set("language", languageParam);

                // TODO support output and language 
                //actionRequestData.outputType = outputType;
                //actionRequestData.outputLanguage = outputLanguage;

            // Call backend conversion and service functions
            let actionResultPromise = this.toolsManager.invokeActionFunction(buttonConfig.actionfunction, parameterMap);

            this.handleResponseActionFunction(action , actionResultPromise);
        
            PlaygroundUtility.longNotification("Executing program");
        }
    }


    togglePanelById(elementId) {
        const panelElement = document.getElementById(elementId);
        if (panelElement) {
            const parentElement = panelElement.parentElement;
            this.toggle(parentElement.id);
        }
    }
    

    toggle(elementId, onEmpty) {
        var element = document.getElementById(elementId);
        if (element == null) return;

        if (getComputedStyle(element).display == "none") {
            element.style.display = "flex";
            if (element.innerHTML.length == 0) {
                onEmpty();
            }
        }
        else {
            element.style.display = "none";
        }
        this.updateGutterVisibility();
    }


    updateGutterVisibility() {
        for (const gutter of Array.prototype.slice.call(document.getElementsByClassName("gutter"))) {

            var visibleSiblings = Array.prototype.slice.call(gutter.parentNode.children).filter(
                child => child != gutter && getComputedStyle(child).display != "none");
            
            if (visibleSiblings.length > 1) {
                var nextVisibleSibling = this.getNextVisibleSibling(gutter);
                var previousVisibleSibling = this.getPreviousVisibleSibling(gutter);
                if (nextVisibleSibling != null && nextVisibleSibling.className != "gutter" && previousVisibleSibling != null) {
                    gutter.style.display = "flex";
                }
                else {
                    gutter.style.display = "none";
                }
            }
            else {
                gutter.style.display = "none";
            }
        }
    }

    getNextVisibleSibling(element) {
        var sibling = element.nextElementSibling;
        while (sibling != null) {
            if (getComputedStyle(sibling).display != "none") return sibling;
            sibling = sibling.nextElementSibling;
        }
    }

    getPreviousVisibleSibling(element) {
        var sibling = element.previousElementSibling;
        while (sibling != null) {
            if (getComputedStyle(sibling).display != "none") return sibling;
            sibling = sibling.previousElementSibling;
        }
    }

    /**
     * Recursively gathers all panels that can be saved, flattening CompositePanels.
     * @param {Panel[]} panels - The list of panels to check.
     * @returns {SaveablePanel[]} A list of panels that can be saved.
     */
    getSaveablePanels(panels) {
        let saveablePanels = [];

        for (const panel of panels) {
            if (panel instanceof CompositePanel) {
                // Recursively flatten composite panels
                saveablePanels.push(...this.getSaveablePanels(panel.childPanels));
            }
            else if (panel instanceof SaveablePanel) {
                saveablePanels.push(panel);
            }
        }
        return saveablePanels;
    }

    /**
     * Collects all panels that have unsaved changes.
     * @returns {SaveablePanel[]} A list of panels that have unsaved changes.
     */
    getPanelsWithChanges() {
        return this.saveablePanels.filter(panel => panel.canSave());
    }

    /**
     * Check if there are any outstanding changes in the panels that have not been saved.
     * @returns {boolean} true if changes have been made, false otherwise
     */
    changesHaveBeenMade() {
        return this.saveablePanels.some(panel => panel.canSave());
    }

    /**
     * Display a modal which displays a list of panels with unsaved changes.
     * Includes a save button where the user can confirm the save.
     */
    async showSaveConfirmation(event) {
        event.preventDefault();

        this.closeAllModalsExcept("save-confirmation-container");
        this.toggleSaveConfirmationVisibility(true);
       
        const saveConfirmationText = document.getElementById("save-body-text");
        if (this.changesHaveBeenMade()) {
            saveConfirmationText.textContent = "You can review your changes before saving:";

            // Render the anchor tag to review the changes
            this.toggleReviewChangesLink(true);
        }
        else {
            saveConfirmationText.textContent = "There are no changes to be saved.";
            this.toggleReviewChangesLink(false);
        }

        const closeButton = document.getElementById("save-confirmation-close-button");
        closeButton.onclick = () => {
            this.toggleSaveConfirmationVisibility(false);
        };

        const cancelButton = document.getElementById("cancel-save-btn");
        cancelButton.onclick = () => {
            this.toggleSaveConfirmationVisibility(false);
        };

        const saveButton = document.getElementById("confirm-save-btn");
        saveButton.onclick = async () => {
            await this.savePanelContents();
            this.toggleSaveConfirmationVisibility(false);
        };
    }

    /**
     * Checks if the changed files in the local environment is outdated compared to the remote repository.
     * @returns {boolean} true if the local environment is outdated, false otherwise.
     */
    async isLocalEnvironmentOutdated() {
        const panelsToSave = this.getPanelsWithChanges();
        for (const panel of panelsToSave) {

            const remoteFile = await this.fileHandler.fetchFile(panel.getFileUrl(), utility.urlParamPrivateRepo());

            if (!remoteFile) {
                throw new Error(`No remote file found for ${panel.getName()}`);
            }

            // Compare the remote SHA with the panel's current SHA. If they differ, the local environment is outdated.
            if (remoteFile.sha !== panel.getValueSha()) {
                return true;
            }
        }
    }

    /**
     * Display a prompt and return the commit message entered by the user.
     * @returns {String} The commit message entered by the user, or the default message if the input is empty.
     */
    getCommitMessage() {
        let commitMessage = prompt("Type your commit message:", DEFAULT_COMMIT_MESSAGE);

        // If the user clicks "Cancel", commitMessage will be null
        if (commitMessage === null) {
            return null;
        }

        // Use default message if input is empty or just whitespace
        if (commitMessage.trim() === "") {
            commitMessage = DEFAULT_COMMIT_MESSAGE;
        }

        return commitMessage;
    }

    /**
     * Gathers the commit message and calls to save the panel contents.
     * Provides UI feedback on the success or failure of the save operation.
     */
    async savePanelContents() {

        if (!this.changesHaveBeenMade()) {
            PlaygroundUtility.warningNotification("There are no panels to save.");
            return;
        }

        if (await this.isLocalEnvironmentOutdated()) {
            PlaygroundUtility.warningNotification("The changes made to the panels are outdated - please save your work to a new branch.")
            return;
        }

        const commitMessage = this.getCommitMessage();
        // If the user clicks "Cancel", stop execution
        if (commitMessage === null) {
            return;
        }

        this.saveFiles(commitMessage)
        .then(() => {
            PlaygroundUtility.successNotification("The activity panel contents have been saved.");
        })
        .catch(error => {
            console.error(error);
            this.errorHandler.notify("An error occurred while trying to save the panel contents.");
        });
    }

    /**
     * Saves the content of the panels to the remote repository.
     * @param {String} commitMessage - The commit message to be used for the save.
     * @param {String} overrideBranch - Optional - by default the current branch is used.
     * @returns {Promise<void>} A promise that resolves when the save is complete.
     */
    async saveFiles(commitMessage, overrideBranch) {
        return new Promise((resolve, reject) => {

            const panelsToSave = this.getPanelsWithChanges();

            // Build up the files to save
            let files = [];
            for (const panel of panelsToSave) {
                files.push(panel.exportSaveData());
            }

            this.fileHandler.storeFiles(files, commitMessage, overrideBranch)
            .then(response => {
                // If the save was to a new branch, skip the panel value updates - this is done in the branch switch
                if (!overrideBranch) {
                    // Returns a [ {path, sha} ] list corresponding to each file
                    let dataReturned = JSON.parse(response);

                    for (const panel of panelsToSave) {
                        const filePath = panel.getFilePath();

                        // Find the updated file that matches the panel's file path
                        const updatedFile = dataReturned.files.find(file => file.path === filePath);
                        const newSha = updatedFile.sha;
                        panel.setValueSha(newSha);
                        panel.setLastSavedContent(panel.getValue());

                        // Mark the editor clean if the save completed
                        panel.getEditor().session.getUndoManager().markClean();

                        console.log(`The contents of panel '${panel.getName()}' were saved successfully.`);
                    }
                }
                resolve();
            })
            .catch(error => {
                reject(error);
            });
        })
    }

    /**
     * Computes the differences between the last saved content and the current panel content
     * @returns {Map} A map of panel IDs to their respective changes
     */
    async getPanelDiffs() {
        const panelDiffsMap = new Map();

        try {
            const panelsToSave = this.getPanelsWithChanges();

            for (const panel of panelsToSave) {

                const lastSavedContent = panel.getLastSavedContent();
                const panelContent = panel.getValue();
    
                // Generate diff using jsdiff
                const diff = Diff.diffLines(lastSavedContent, panelContent);
    
                // Process diff parts to only include added or removed segments
                const changes = diff
                    .map(part => {
                        let change = {};
                        if (part.added) {
                            change.added = part.value;
                        } 
                        else if (part.removed) {
                            change.removed = part.value;
                        }
                        return change;
                    })
                    .filter(change => change.added || change.removed); // Only include meaningful changes
                
                // Store the changes in the Map with the panel's name as key
                panelDiffsMap.set(panel.getName(), changes);
            }
            return panelDiffsMap;
        } 
        catch (error) {
            console.error(error);
            this.errorHandler.notify("An error occurred while computing the panel changes.");
        }
    }

    /**
     * Provide the user with a way to see their unsaved changes in a seperate tab.
     */
    async reviewChanges(event) {
        event.preventDefault();

        this.closeAllModalsExcept("review-changes-container");
        this.toggleReviewChangesVisibility(true);

        const closeButton = document.getElementById("review-changes-close-button");
        closeButton.onclick = () => {
            this.toggleReviewChangesVisibility(false);
        };

        const listTitle = document.getElementById("changed-panels-title");
        listTitle.textContent = this.changesHaveBeenMade()
            ? "Review the changes made to the panels:"
            : "There are no changes to the panels.";

        const panelList = document.getElementById("changed-panels-list");
        panelList.innerHTML = ""; // Clear previous list items

        const panelsToSave = this.getPanelsWithChanges();
        const panelDiffs = await this.getPanelDiffs();

        // Populate the list of panels with unsaved changes
        panelsToSave.forEach(panel => {
            const panelName = panel.getName();

            const li = document.createElement("li");
            li.textContent = panel.getName();

            li.addEventListener("click", () => {
                this.displayChangesForPanel(panelName, panelDiffs.get(panelName));
            })

            panelList.appendChild(li);
        })
    }

    /**
     * Refreshes the list of branches, so we always have the most up-to-date state.
     */
    async refreshBranches() {
        try {
            this.branches = await this.fileHandler.fetchBranches(this.activityURL);
        } catch (error) {
            console.error("Error fetching branches:", error);
        }
    }

    /**
     * Displays a modal which shows the changes made to a given panel since the last save.
     * @param {String} panelId - The ID of the panel to display changes for.
     * @param {Array} panelDiff - The diffs of the panel contents.
     */
    displayChangesForPanel(panelId, panelDiff) {

        this.closeAllModalsExcept("panel-changes-container");
        this.togglePanelChangeVisibility(true);

        const closeButton = document.getElementById("panel-changes-close-button");
        closeButton.onclick = () => {
            this.togglePanelChangeVisibility(false);
        };

        const backButton = document.getElementById("panel-changes-back-button");
        backButton.onclick = () => {
            this.togglePanelChangeVisibility(false);
            this.toggleReviewChangesVisibility(true);
        };

        const title = document.getElementById("panel-title");
        title.textContent = panelId;

        const diffContent = document.getElementById("diff-content");
        diffContent.innerHTML = "";

        // Render the panel changes
        panelDiff.forEach(change => {
            const diffLine = document.createElement("div");
            diffLine.classList.add("diff-line");
            if (change.added) {
                diffLine.classList.add("diff-added");
                diffLine.textContent = "+ " + change.added;
            } 
            else if (change.removed) {
                diffLine.classList.add("diff-removed");
                diffLine.textContent = "- " + change.removed;
            }
            diffContent.appendChild(diffLine);
        })
    }

    async showBranches(event) {
        event.preventDefault();

        try {
            const currentBranch = utility.getCurrentBranch();

            this.closeAllModalsExcept("switch-branch-container");
            await this.toggleSwitchBranchVisibility(true);

            const closeButton = document.getElementById("switch-branch-close-button");
            closeButton.onclick = () => {
                this.toggleSwitchBranchVisibility(false);
            };

            const createBranchButton = document.getElementById("new-branch-button");
            createBranchButton.onclick = () => {
                this.showCreateBranchPrompt(currentBranch);
            };

            this.setCurrentBranchText(currentBranch);

            const branchList = document.getElementById("branch-list");
            this.renderBranchList();

            // Set up the filter logic for the branch search
            const branchSearch = document.getElementById("branch-search");
            branchSearch.oninput = function (event) {
                const filterText = event.target.value.toLowerCase();

                // Filter through the <li> items and show/hide based on the search text
                const listItems = branchList.querySelectorAll("li");
                listItems.forEach(li => {
                    const branchName = li.textContent.toLowerCase();
                    li.style.display = branchName.includes(filterText)
                        ? ""
                        : "none";
                });
            };

        }
        catch (error) {
            console.error(error);
            this.errorHandler.notify("An error occurred while displaying the branches.");
        }
    }

    /**
     * Renders a list of branches fetched from the repository
     * Highlights the branch the user is currently on
     */
    renderBranchList() {
        const currentBranch = utility.getCurrentBranch();

        // Clear old list items
        const branchList = document.getElementById("branch-list");
        branchList.innerHTML = "";

        // For each branch, we add <li> with the branch name
        this.branches.forEach((branch) => {
            let li = document.createElement("li");
            li.textContent = branch;

            // highlight the currently active branch
            if (branch === currentBranch) {
                li.classList.add("current-branch");
            }

            li.addEventListener("click", () => {

                if (this.changesHaveBeenMade()) {
                    const confirmSwitch = confirm(
                        "⚠️ You have unsaved changes!\n\n" +
                        "Switching branches will discard your unsaved work.\n" +
                        "Do you want to continue?\n\n" +
                        "✔ OK to switch branches\n" +
                        "✖ Cancel to stay on this branch"
                    );
                
                    if (!confirmSwitch) {
                        this.confirmLeavePage = false;
                        return;
                    }
                    else {
                        // Change the flag to prevent the "Leave Page" warning
                        this.confirmLeavePage = true;
                    }
                }

                this.switchBranch(currentBranch, branch);
            });
            branchList.appendChild(li);
        });
    }

    /**
     * Switch to a different branch in the repository
     * Changes the branch parameter in the URL 
     * @param {String} currentBranch 
     * @param {String} branchToSwitchTo 
     */
    switchBranch(currentBranch, branchToSwitchTo) {
        const currentURL = utility.getWindowLocationHref();
        const targetURL = currentURL.replace("/" + currentBranch + "/", "/" + branchToSwitchTo + "/");

        utility.setWindowLocationHref(targetURL);
    }

    /**
     * Displays a window to create and check out a new branch in the repository
     * @param {String} currentBranch - the current branch the user is on
     */
    async showCreateBranchPrompt(currentBranch) {

        this.closeAllModalsExcept("create-branch-container");
        await this.toggleCreateBranchVisibility(true);

        const closeButton = document.getElementById("create-branch-close-button");
        closeButton.onclick = () => {
            this.hideSwitchToBranchLink();
            this.toggleCreateBranchVisibility(false);
        };

        const backButton = document.getElementById("create-branch-back-button");
        backButton.onclick = async () => {
            this.toggleCreateBranchVisibility(false);
            this.hideSwitchToBranchLink();
            await this.toggleSwitchBranchVisibility(true);
        };

        document.getElementById("create-branch-based-on-text").textContent = currentBranch;

        // Clear the input
        const newBranchInput = document.getElementById("new-branch-name");
        newBranchInput.value = "";

        const submitButton = document.getElementById("create-branch-submit-button");
        submitButton.onclick = () => {
            // Replace spaces with dashes
            const newBranch = newBranchInput.value.trim().replace(/\s+/g, '-');

            // Check if the branch already exists
            if (this.branches.includes(newBranch)) {
                PlaygroundUtility.warningNotification("Branch " + newBranch + " already exists.");
                return;
            }

            // Validate the branch name
            if (!utility.validateBranchName(newBranch)) {
                PlaygroundUtility.warningNotification("Invalid branch name. Please try again.");
                return;
            }

            // Check for unsaved changes
            if(this.changesHaveBeenMade()) {
                this.displayCreateBranchConfirmModal(currentBranch, newBranch);
            }
            else {
                // No unsaved changes, simply create the branch and switch to it
                this.fileHandler.createBranch(this.activityURL, newBranch)
                .then(() => {
                    PlaygroundUtility.successNotification("Branch " + newBranch + " created successfully");
                    this.displaySwitchToBranchLink(currentBranch, newBranch);
                })
                .catch((error) => {
                    console.error(error);
                    this.errorHandler.notify("An error occurred while creating a branch.");
                });
            }
        };
    }

    displayCreateBranchConfirmModal(currentBranch, newBranch) {
        this.toggleCreateBranchVisibility(false);
        this.toggleCreateBranchConfirmVisibility(true);

        this.setCurrentBranchText(currentBranch);

        const newBranchHTML = document.querySelectorAll("#new-branch");
        newBranchHTML.forEach(element => element.textContent = newBranch);

        const closeButton = document.getElementById("create-branch-confirm-close-button");
        closeButton.onclick = () => {
            this.toggleCreateBranchConfirmVisibility(false);
            this.hideSwitchToBranchLink();
        };

        const backButton = document.getElementById("create-branch-confirm-back-button");
        backButton.onclick = async () => {
            this.toggleCreateBranchConfirmVisibility(false);
            this.hideSwitchToBranchLink();
            await this.toggleCreateBranchVisibility(true);
        };

        const confirmButton = document.getElementById("confirm-bring-changes");
        confirmButton.onclick = () => {
            this.fileHandler.createBranch(this.activityURL, newBranch)
            .then(() => {
                // Save the changes to this new branch
                this.saveFiles("Merge changes from " + currentBranch + " to " + newBranch, newBranch)
                    .then(() => {
                        PlaygroundUtility.successNotification("Branch " + newBranch + " created successfully");
                        this.displaySwitchToBranchLink(currentBranch, newBranch);

                        // Undo the changes made to the panels to keep the current branch clean
                        this.undoPanelChanges();
                    })
                    .catch((error) => {
                        console.error(error);
                        this.errorHandler.notify("An error occured while trying to bring the changes over to the new branch");
                    });
            })
            .catch((error) => {
                console.error(error);
                this.errorHandler.notify("An error occurred while creating a branch.");
            });
        };

        const discardButton = document.getElementById("discard-changes");
        discardButton.onclick = () => {
            this.fileHandler.createBranch(this.activityURL, newBranch)
            .then(() => {
                // Undo the changes made to the panels to keep the current branch clean
                this.undoPanelChanges();

                PlaygroundUtility.successNotification("Branch " + newBranch + " created successfully");
                this.displaySwitchToBranchLink(currentBranch, newBranch);
            })
            .catch((error) => {
                console.error(error);
                this.errorHandler.notify("An error occurred while creating a branch.");
            });
        }
    }

    /**
     * Hide all modals except the one with the given ID
     * @param {String} exceptionModalId - The HTML id of the modal to keep open
     */
    closeAllModalsExcept(exceptionModalId) {
        // Get all elements with the common modal container class
        const containers = document.querySelectorAll('.container-modal');
        containers.forEach(container => {
            // If this container is not the exception, hide it
            if (container.id !== exceptionModalId) {
                container.style.display = "none";
            }
        });
    }

    setCurrentBranchText(currentBranch) {
        const currentBranchElements = document.querySelectorAll("#current-branch");
        currentBranchElements.forEach(element => element.textContent = currentBranch);
    }

    undoPanelChanges() {
        this.saveablePanels.forEach(panel => panel.resetChanges());
    }

    async toggleSwitchBranchVisibility(visibility) {
        const container = document.getElementById("switch-branch-container");
        if (visibility) {
            await this.refreshBranches();
            // Re-render the list of branches
            this.renderBranchList();
        }
        container.style.display = visibility ? "block" : "none";
    }

    async toggleCreateBranchVisibility(visibility) {
        const container = document.getElementById("create-branch-container");
        if (visibility) {
            await this.refreshBranches();
        }
        container.style.display = visibility ? "block" : "none";
    }

    toggleSaveConfirmationVisibility(visibility) {
        const container = document.getElementById("save-confirmation-container");
        visibility ? container.style.display = "block" : container.style.display = "none";
    }

    togglePanelChangeVisibility(visibility) {
        const container = document.getElementById("panel-changes-container");
        visibility ? container.style.display = "block" : container.style.display = "none";
    }

    toggleReviewChangesVisibility(visibility) {
        const container = document.getElementById("review-changes-container");
        visibility ? container.style.display = "block" : container.style.display = "none";
    }

    toggleCreateBranchConfirmVisibility(visibility) {
        const container = document.getElementById("create-branch-confirm-container");
        visibility ? container.style.display = "block" : container.style.display = "none";
    }

    toggleReviewChangesLink(visibility) {
        const link = document.getElementById("review-changes-link");
        visibility ? link.style.display = "block" : link.style.display = "none";
    
        if (visibility) {
            document.getElementById("review-changes-anchor").onclick = (event) => {
                event.preventDefault();
                this.reviewChanges(event);
            };
        }
    }

    hideSwitchToBranchLink() {
        document.querySelectorAll("#switch-branch-name").forEach(name => name.textContent = "");
        document.querySelectorAll("#switch-to-branch-link").forEach(link => link.style.display = "none")
        document.querySelectorAll("#switch-branch-anchor").forEach(anchor => anchor.onclick = null);
    }

    displaySwitchToBranchLink(currentBranch, branchToSwitchTo) {
        document.querySelectorAll("#switch-branch-name").forEach(name => name.textContent = branchToSwitchTo);
        document.querySelectorAll("#switch-to-branch-link").forEach(link => link.style.display = "block");

        document.querySelectorAll("#switch-branch-anchor").forEach(anchor => {
            anchor.onclick = (event) => {
                event.preventDefault();
                this.switchBranch(currentBranch, branchToSwitchTo);
            };
        });
    }

    /**
     * Open a websockets connection to receive status updates on editor build. 
     * @param {String} statusUrl - the url for checking the status of the editor panel.
     * @param {String} editorInstanceUrl - the editor instance's url. 
     * @param {String} editorPanelId - the id of the editor panel.
     * @param {String} editorActivityId - TODO remove as this can be found using editorPanelId to save having to specify in config.
     * @param {Panel} logPanel - the panel to log progress to.
     */
    checkEditorReady(editorID, editorInstanceUrl, editorPanelId, editorActivityId, logPanel){
        var socket = new WebSocket(this.wsUri);
        var editorReady = false;
        socket.onopen = function(){
            socket.send(editorID);
        };

        socket.onmessage = function(e){
            var resultData = JSON.parse(e.data);
            if (resultData.output){
                logPanel.setValue(resultData.output);
            }
            if(resultData.editorReady){
                editorReady = true;
                socket.close();
                sessionStorage.setItem( editorPanelId , editorInstanceUrl );
                this.activityManager.setActivityVisibility(editorActivityId, true);
                Metro.notify.killAll();
                PlaygroundUtility.successNotification("Building complete.");
            }
        }.bind(this);

        socket.onclose = function(){
            //If editor is not deployed, a new connection must be established.
            if (!editorReady){
                if(!socket || socket.readyState == 3){
                    this.checkEditorReady(editorID, editorInstanceUrl, editorPanelId, editorActivityId, logPanel);
                }
            }
        }.bind(this);

            
        if(!socket || socket.readyState == 3){
            this.checkEditorReady(editorID, editorInstanceUrl, editorPanelId, editorActivityId, logPanel);
        }
    }
}

export {EducationPlatformApp}