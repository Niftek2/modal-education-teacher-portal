/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Assign from './pages/Assign';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import ManageCatalog from './pages/ManageCatalog';
import RequestHistory from './pages/RequestHistory';
import SelectProgram from './pages/SelectProgram';
import StudentAssignments from './pages/StudentAssignments';
import StudentAssignmentsLogin from './pages/StudentAssignmentsLogin';
import Verify from './pages/Verify';
import WebhookDebug from './pages/WebhookDebug';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Assign": Assign,
    "Dashboard": Dashboard,
    "Home": Home,
    "ManageCatalog": ManageCatalog,
    "RequestHistory": RequestHistory,
    "SelectProgram": SelectProgram,
    "StudentAssignments": StudentAssignments,
    "StudentAssignmentsLogin": StudentAssignmentsLogin,
    "Verify": Verify,
    "WebhookDebug": WebhookDebug,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};