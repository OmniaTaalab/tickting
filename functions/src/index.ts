import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated, onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";

const GMAIL_SERVICE_ACCOUNT_KEY = defineSecret("GMAIL_SERVICE_ACCOUNT_KEY");

admin.initializeApp();

const BASE_URL = "https://studio--studio-7708718228-149dc.us-central1.hosted.app";
const DEFAULT_SENDER_EMAIL = "info@nis-egypt.com";

type MailboxRoute = {
    division: string;
    school: string;
    grades: string[];
};

type MailboxConfig = {
    email: string;
    department: string;
    campusId?: string;
    campusName?: string;
    routes?: MailboxRoute[];
    enabled?: boolean;
};

type ResolvedRouting = {
    selectedRoute: MailboxRoute | null;
    schoolName: string | null;
    divisionName: string | null;
    gradeName: string | null;
    schools: string[];
    divisions: string[];
    allowedGrades: string[];
};

function academicMailbox(
    email: string,
    campusId: string,
    campusName: string,
    routes: MailboxRoute[]
): MailboxConfig {
    return {
        email,
        department: "Academic",
        campusId,
        campusName,
        routes,
        enabled: true,
    };
}

const MAILBOXES: MailboxConfig[] = [

    // Collection / Accounting
    {
        email: "accounting.1stsettlement@nis-egypt.com",
        department: "Collection",
        campusId: "VD4fBBRBUAKmdNteZocG",
        campusName: "1st Settlement",
        enabled: true,
    },
    {
        email: "accounting.shorouk@nis-egypt.com",
        department: "Collection",
        campusId: "yo3Wwso55VNU0wG3Oq4S",
        campusName: "El-Sherouk",
        enabled: true,
    },
    {
        email: "accounting.6thoctober@nis-egypt.com",
        department: "Collection",
        campusId: "5c1TfIe5ePQhicggJrP8",
        campusName: "6th October",
        enabled: true,
    },
    {
        email: "Accounting.NasrCity@nis-egypt.com",
        department: "Collection",
        campusId: "daZr2WQAV0WJlOGPpKFV",
        campusName: "Nasr City",
        enabled: true,
    },
    {
        email: "accounting.newcapital.int@nis-egypt.com",
        department: "Collection",
        campusId: "Qlqa5RuNvLuFuPAFnTmF",
        campusName: "New Capital International",
        enabled: true,
    },
    {
        email: "accounting.newcapital.national@nis-egypt.com",
        department: "Collection",
        campusId: "NySuXzwGRFnLiO3pAxie",
        campusName: "New Capital National",
        enabled: true,
    },
    {
        email: "accounting.portosaid@nis-egypt.com",
        department: "Collection",
        campusId: "ZKLWPTV7ip6bC6dK95L4",
        campusName: "Porto Said",
        enabled: true,
    },

    // Admissions
    {
        email: "admission.newcapital.national@nis-egypt.com",
        department: "Admissions",
        campusId: "NySuXzwGRFnLiO3pAxie",
        campusName: "New Capital National",
        enabled: true,
    },
    {
        email: "admission.newcapital.int@nis-egypt.com",
        department: "Admissions",
        campusId: "Qlqa5RuNvLuFuPAFnTmF",
        campusName: "New Capital International",
        enabled: true,
    },
    {
        email: "admission.shorouk@nis-egypt.com",
        department: "Admissions",
        campusId: "yo3Wwso55VNU0wG3Oq4S",
        campusName: "El-Sherouk",
        enabled: true,
    },
    {
        email: "admission.1stsettlement@nis-egypt.com",
        department: "Admissions",
        campusId: "VD4fBBRBUAKmdNteZocG",
        campusName: "1st Settlement",
        enabled: true,
    },
    {
        email: "admission.6thoctober@nis-egypt.com",
        department: "Admissions",
        campusId: "5c1TfIe5ePQhicggJrP8",
        campusName: "6th October",
        enabled: true,
    },
    {
        email: "admission.portosaid@nis-egypt.com",
        department: "Admissions",
        campusId: "ZKLWPTV7ip6bC6dK95L4",
        campusName: "Porto Said",
        enabled: true,
    },
    {
        email: "admission.nasrcity@nis-egypt.com",
        department: "Admissions",
        campusId: "daZr2WQAV0WJlOGPpKFV",
        campusName: "Nasr City",
        enabled: true,
    },

    // Shared queues
    {
        email: "Operations@nis-egypt.com",
        department: "Operations",
        enabled: true,
    },
    {
        email: "Info@nis-egypt.com",
        department: "General support",
        enabled: true,
    },

    // Academic queues
//     academicMailbox(
//         "ks1-2-nci-br@nis-egypt.com",
//         "Qlqa5RuNvLuFuPAFnTmF",
//         "New Capital International",
//         [
//             {
//                 division: "Elementary",
//                 school: "British",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ks3.ca@nis-egypt.com",
//         "Qlqa5RuNvLuFuPAFnTmF",
//         "New Capital International",
//         [
//             {
//                 division: "Middle School",
//                 school: "British",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ig.ca@nis-egypt.com",
//         "Qlqa5RuNvLuFuPAFnTmF",
//         "New Capital International",
//         [
//             {
//                 division: "High School",
//                 school: "British",
//                 grades: ["Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "nca.elementaryoffice@nis-egypt.com",
//         "Qlqa5RuNvLuFuPAFnTmF",
//         "New Capital International",
//         [
//             {
//                 division: "Elementary",
//                 school: "American",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ca.am.ms@nis-egypt.com",
//         "Qlqa5RuNvLuFuPAFnTmF",
//         "New Capital International",
//         [
//             {
//                 division: "Middle School",
//                 school: "American",
//                 grades: ["Grade6", "Grade7", "Grade8"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ca.high-school@nis-egypt.com",
//         "Qlqa5RuNvLuFuPAFnTmF",
//         "New Capital International",
//         [
//             {
//                 division: "High School",
//                 school: "American",
//                 grades: ["Grade9", "Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ey.nci@nis-egypt.com",
//         "Qlqa5RuNvLuFuPAFnTmF",
//         "New Capital International",
//         [
//             {
//                 division: "Early Years",
//                 school: "American",
//                 grades: ["Pre school", "KG1", "KG2"],
//             },
//             {
//                 division: "Early Years",
//                 school: "British",
//                 grades: ["Foundation Stage 1", "Foundation Stage 2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "kg.ncn@nis-egypt.com",
//         "NySuXzwGRFnLiO3pAxie",
//         "New Capital National",
//         [
//             {
//                 division: "Early Years",
//                 school: "National English",
//                 grades: ["KG1", "KG2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "lowerprimary.ncn@nis-egypt.com",
//         "NySuXzwGRFnLiO3pAxie",
//         "New Capital National",
//         [
//             {
//                 division: "Elementary",
//                 school: "National English",
//                 grades: ["Grade1", "Grade2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "primary.ncn@nis-egypt.com",
//         "NySuXzwGRFnLiO3pAxie",
//         "New Capital National",
//         [
//             {
//                 division: "Elementary",
//                 school: "National English",
//                 grades: ["Grade3", "Grade4"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "upperprimary.ncn@nis-egypt.com",
//         "NySuXzwGRFnLiO3pAxie",
//         "New Capital National",
//         [
//             {
//                 division: "Elementary",
//                 school: "National English",
//                 grades: ["Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "preparatory.ncn@nis-egypt.com",
//         "NySuXzwGRFnLiO3pAxie",
//         "New Capital National",
//         [
//             {
//                 division: "Middle School",
//                 school: "National English",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "secondary.ncn@nis-egypt.com",
//         "NySuXzwGRFnLiO3pAxie",
//         "New Capital National",
//         [
//             {
//                 division: "High School",
//                 school: "National English",
//                 grades: ["Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "nis-earlyyears-oc@nis-egypt.com",
//         "5c1TfIe5ePQhicggJrP8",
//         "6th October",
//         [
//             {
//                 division: "Early Years",
//                 school: "American",
//                 grades: ["Pre school", "KG1", "KG2"],
//             },
//             {
//                 division: "Early Years",
//                 school: "British",
//                 grades: ["Foundation Stage 1", "Foundation Stage 2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "nis-keystage1-2-oc@nis-egypt.com",
//         "5c1TfIe5ePQhicggJrP8",
//         "6th October",
//         [
//             {
//                 division: "Elementary",
//                 school: "British",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "nis-keystage3-4-oc@nis-egypt.com",
//         "5c1TfIe5ePQhicggJrP8",
//         "6th October",
//         [
//             {
//                 division: "Middle School",
//                 school: "British",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             },
//             {
//                 division: "High School",
//                 school: "British",
//                 grades: ["Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "nis-elementaryschool-oc@nis-egypt.com",
//         "5c1TfIe5ePQhicggJrP8",
//         "6th October",
//         [
//             {
//                 division: "Elementary",
//                 school: "American",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "nis-middleschool-oc@nis-egypt.com",
//         "5c1TfIe5ePQhicggJrP8",
//         "6th October",
//         [
//             {
//                 division: "Middle School",
//                 school: "American",
//                 grades: ["Grade6", "Grade7", "Grade8"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "nis-highschool-oc@nis-egypt.com",
//         "5c1TfIe5ePQhicggJrP8",
//         "6th October",
//         [
//             {
//                 division: "High School",
//                 school: "American",
//                 grades: ["Grade9", "Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "kgamerican.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Early Years",
//                 school: "American",
//                 grades: ["Pre school", "KG1", "KG2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "elementary.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Elementary",
//                 school: "American",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "middleschool.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Middle School",
//                 school: "American",
//                 grades: ["Grade6", "Grade7", "Grade8"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "highschool.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "High School",
//                 school: "American",
//                 grades: ["Grade9", "Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ibschool.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "High School",
//                 school: "IB",
//                 grades: ["Grade9", "Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "kgfrench.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Early Years",
//                 school: "National French",
//                 grades: ["Pre school", "KG1", "KG2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "primairefrench.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Elementary",
//                 school: "National French",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "préparatoirefrench.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Middle School",
//                 school: "National French",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "secondairefrench.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "High School",
//                 school: "National French",
//                 grades: ["Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "kgnational.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Early Years",
//                 school: "National English",
//                 grades: ["KG1", "KG2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "lowerprimarynational.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Elementary",
//                 school: "National English",
//                 grades: ["Grade1", "Grade2", "Grade3"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "upperprimarynational.tag@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Elementary",
//                 school: "National English",
//                 grades: ["Grade4", "Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "preparatorynational@nis-egypt.com",
//         "VD4fBBRBUAKmdNteZocG",
//         "1st Settlement",
//         [
//             {
//                 division: "Middle School",
//                 school: "National English",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ey.ps@nis-egypt.com",
//         "ZKLWPTV7ip6bC6dK95L4",
//         "Porto Said",
//         [
//             {
//                 division: "Early Years",
//                 school: "American",
//                 grades: ["Pre school", "KG1", "KG2"],
//             },
//             {
//                 division: "Early Years",
//                 school: "British",
//                 grades: ["Foundation Stage 1", "Foundation Stage 2"],
//             },
//             {
//                 division: "Early Years",
//                 school: "National French",
//                 grades: ["Pre school", "KG1", "KG2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "el.ps@nis-egypt.com",
//         "ZKLWPTV7ip6bC6dK95L4",
//         "Porto Said",
//         [
//             {
//                 division: "Elementary",
//                 school: "American",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5"],
//             },
//             {
//                 division: "Elementary",
//                 school: "British",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "pr.ps@nis-egypt.com",
//         "ZKLWPTV7ip6bC6dK95L4",
//         "Porto Said",
//         [
//             {
//                 division: "Elementary",
//                 school: "National French",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ms-am.ps@nis-egypt.com",
//         "ZKLWPTV7ip6bC6dK95L4",
//         "Porto Said",
//         [
//             {
//                 division: "Middle School",
//                 school: "American",
//                 grades: ["Grade6", "Grade7", "Grade8"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "hs-am.ps@nis-egypt.com",
//         "ZKLWPTV7ip6bC6dK95L4",
//         "Porto Said",
//         [
//             {
//                 division: "High School",
//                 school: "American",
//                 grades: ["Grade9", "Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ms-br.ps@nis-egypt.com",
//         "ZKLWPTV7ip6bC6dK95L4",
//         "Porto Said",
//         [
//             {
//                 division: "Middle School",
//                 school: "British",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "hs-br.ps@nis-egypt.com",
//         "ZKLWPTV7ip6bC6dK95L4",
//         "Porto Said",
//         [
//             {
//                 division: "High School",
//                 school: "British",
//                 grades: ["Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ey.shorouk@nis-egypt.com",
//         "yo3Wwso55VNU0wG3Oq4S",
//         "El-Sherouk",
//         [
//             {
//                 division: "Early Years",
//                 school: "American",
//                 grades: ["Pre school", "KG1", "KG2"],
//             },
//             {
//                 division: "Early Years",
//                 school: "British",
//                 grades: ["Foundation Stage 1", "Foundation Stage 2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "es.shorouk@nis-egypt.com",
//         "yo3Wwso55VNU0wG3Oq4S",
//         "El-Sherouk",
//         [
//             {
//                 division: "Elementary",
//                 school: "American",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ms.shorouk@nis-egypt.com",
//         "yo3Wwso55VNU0wG3Oq4S",
//         "El-Sherouk",
//         [
//             {
//                 division: "Middle School",
//                 school: "American",
//                 grades: ["Grade6", "Grade7", "Grade8"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "hs.shorouk@nis-egypt.com",
//         "yo3Wwso55VNU0wG3Oq4S",
//         "El-Sherouk",
//         [
//             {
//                 division: "High School",
//                 school: "American",
//                 grades: ["Grade9", "Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ks1.shorouk@nis-egypt.com",
//         "yo3Wwso55VNU0wG3Oq4S",
//         "El-Sherouk",
//         [
//             {
//                 division: "Elementary",
//                 school: "British",
//                 grades: ["Grade1", "Grade2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ks2.shorouk@nis-egypt.com",
//         "yo3Wwso55VNU0wG3Oq4S",
//         "El-Sherouk",
//         [
//             {
//                 division: "Elementary",
//                 school: "British",
//                 grades: ["Grade3", "Grade4", "Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ks3.shorouk@nis-egypt.com",
//         "yo3Wwso55VNU0wG3Oq4S",
//         "El-Sherouk",
//         [
//             {
//                 division: "Middle School",
//                 school: "British",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "ig.shorouk@nis-egypt.com",
//         "yo3Wwso55VNU0wG3Oq4S",
//         "El-Sherouk",
//         [
//             {
//                 division: "High School",
//                 school: "British",
//                 grades: ["Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "kg.nc@nis-egypt.com",
//         "daZr2WQAV0WJlOGPpKFV",
//         "Nasr City",
//         [
//             {
//                 division: "Early Years",
//                 school: "National English",
//                 grades: ["KG1", "KG2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "lowerprimary.nc@nis-egypt.com",
//         "daZr2WQAV0WJlOGPpKFV",
//         "Nasr City",
//         [
//             {
//                 division: "Elementary",
//                 school: "National English",
//                 grades: ["Grade1", "Grade2"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "upperprimary.nc-g@nis-egypt.com",
//         "daZr2WQAV0WJlOGPpKFV",
//         "Nasr City",
//         [
//             {
//                 division: "Elementary",
//                 school: "National English",
//                 grades: ["Grade3", "Grade4", "Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "upperprimary.nc-b@nis-egypt.com",
//         "daZr2WQAV0WJlOGPpKFV",
//         "Nasr City",
//         [
//             {
//                 division: "Elementary",
//                 school: "National English",
//                 grades: ["Grade3", "Grade4", "Grade5", "Grade6"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "preparatory.nc-g@nis-egypt.com",
//         "daZr2WQAV0WJlOGPpKFV",
//         "Nasr City",
//         [
//             {
//                 division: "Middle School",
//                 school: "National English",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "preparatory.nc-b@nis-egypt.com",
//         "daZr2WQAV0WJlOGPpKFV",
//         "Nasr City",
//         [
//             {
//                 division: "Middle School",
//                 school: "National English",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "secondary.nc-g@nis-egypt.com",
//         "daZr2WQAV0WJlOGPpKFV",
//         "Nasr City",
//         [
//             {
//                 division: "High School",
//                 school: "National English",
//                 grades: ["Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "secondary.nc-b@nis-egypt.com",
//         "daZr2WQAV0WJlOGPpKFV",
//         "Nasr City",
//         [
//             {
//                 division: "High School",
//                 school: "National English",
//                 grades: ["Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     ),

//     academicMailbox(
//         "br-nc.office@nis-egypt.com",
//         "daZr2WQAV0WJlOGPpKFV",
//         "Nasr City",
//         [
//             {
//                 division: "Early Years",
//                 school: "British",
//                 grades: ["Foundation Stage 1", "Foundation Stage 2"],
//             },
//             {
//                 division: "Elementary",
//                 school: "British",
//                 grades: ["Grade1", "Grade2", "Grade3", "Grade4", "Grade5", "Grade6"],
//             },
//             {
//                 division: "Middle School",
//                 school: "British",
//                 grades: ["Grade7", "Grade8", "Grade9"],
//             },
//             {
//                 division: "High School",
//                 school: "British",
//                 grades: ["Grade10", "Grade11", "Grade12"],
//             }
//         ]
//     )
 ];

function normalizeMessageId(value?: string | null): string | null {
    if (!value) return null;
    return value.trim().replace(/^<|>$/g, "");
}

function parseReferences(value?: string | null): string[] {
    if (!value) return [];
    return value
        .split(/\s+/)
        .map((v) => normalizeMessageId(v))
        .filter((v): v is string => Boolean(v));
}

function generateRandom4Digit(): number {
    return Math.floor(1000 + Math.random() * 9000);
}

function isWorkingTime(workingHours: any): boolean {
    if (!workingHours) return true;

    const now = new Date();

    const dayName = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: "Africa/Cairo",
    }).format(now);

    const currentTimeStr = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Africa/Cairo",
    }).format(now);

    const config = workingHours[dayName];

    if (!config || !config.isOpen) return false;

    return currentTimeStr >= config.start && currentTimeStr <= config.end;
}

function getWorkingHoursSummary(workingHours: any): string {
    if (!workingHours) return "24/7";

    const days = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];

    const summaries = days
        .filter((day) => workingHours[day] && workingHours[day].isOpen)
        .map(
            (day) =>
                `${day.substring(0, 3)}: ${workingHours[day].start}-${workingHours[day].end}`
        );

    return summaries.length > 0 ? summaries.join(", ") : "Closed";
}

function replacePlaceholders(text: string, ticket: any, dept: any): string {
    const submittedAt = ticket.createdAt
        ? ticket.createdAt instanceof admin.firestore.Timestamp
            ? ticket.createdAt.toDate()
            : new Date(ticket.createdAt)
        : new Date();

    return String(text || "")
        .replace(
            /{{userName}}/g,
            ticket.parentName || ticket.createdBy?.name || "User"
        )
        .replace(/{{ticketId}}/g, String(ticket.ticketNumber || ""))
        .replace(
            /{{departmentName}}/g,
            ticket.departmentName || ticket.categoryName || ""
        )
        .replace(/{{subject}}/g, ticket.subject || "")
        .replace(
            /{{submittedAt}}/g,
            submittedAt.toLocaleString("en-US", {
                timeZone: "Africa/Cairo",
            })
        )
        .replace(
            /{{workingHours}}/g,
            getWorkingHoursSummary(dept?.workingHours)
        );
}

function escapeHtml(value: string): string {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function wrapInProfessionalTemplate(
    title: string,
    subtitle: string,
    greeting: string,
    content: string,
    ticketUrl: string,
    ticketId: string,
    subject: string
): string {
    void ticketId;

    return `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #1e3a8a; color: white; padding: 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 22px;">${escapeHtml(title)}</h1>
            <p style="margin: 4px 0 0 0; opacity: 0.8; font-size: 14px;">${escapeHtml(subtitle)}</p>
        </div>
        <div style="padding: 40px 30px; line-height: 1.6; color: #334155;">
            <p>Hello <strong>${escapeHtml(greeting)}</strong>,</p>
            <p>Update regarding: <strong>"${escapeHtml(subject)}"</strong></p>
            <div style="background-color: #f8fafc; padding: 24px; border-left: 4px solid #1e3a8a; border-radius: 4px; margin: 24px 0; white-space: pre-wrap;">${escapeHtml(content)}</div>
            <div style="text-align: center; margin: 40px 0;">
                <a href="${escapeHtml(ticketUrl)}" style="background-color: #1e3a8a; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Details</a>
            </div>
        </div>
    </div>
    `;
}

function encodeRawEmail(rawMessage: string): string {
    return Buffer.from(rawMessage)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function createGmailClient(
    key: any,
    senderEmail: string,
    scopes: string[]
): Promise<any> {
    // Dynamic import keeps the heavy googleapis package out of Firebase's
    // deployment-time module initialization path.
    const { google } = await import("googleapis");

    const auth = new google.auth.JWT({
        email: key.client_email,
        key: key.private_key,
        scopes,
        subject: senderEmail,
    });

    return google.gmail({
        version: "v1",
        auth,
    });
}

async function sendHtmlEmail(args: {
    key: any;
    senderEmail: string;
    to: string;
    subject: string;
    html: string;
    fromName?: string;
    extraHeaders?: string[];
}): Promise<void> {
    const gmail = await createGmailClient(
        args.key,
        args.senderEmail,
        ["https://www.googleapis.com/auth/gmail.send"]
    );

    const rawMessage = [
        `From: ${args.fromName || "NIS CRM Support"} <${args.senderEmail}>`,
        `To: ${args.to}`,
        `Subject: ${args.subject}`,
        ...(args.extraHeaders || []).filter(Boolean),
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=UTF-8",
        "",
        args.html,
    ].join("\r\n");

    await gmail.users.messages.send({
        userId: "me",
        requestBody: {
            raw: encodeRawEmail(rawMessage),
        },
    });
}

function getSenderMailbox(ticket: any): string {
    return (
        ticket?.originalRecipientEmail ||
        ticket?.mailboxEmail ||
        DEFAULT_SENDER_EMAIL
    );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(
        new Set(
            values
                .filter((value): value is string => Boolean(value))
                .map((value) => value.trim())
                .filter(Boolean)
        )
    );
}

function normalizeRoutingText(value: string): string {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/pre[\s-]*school/g, "preschool")
        .replace(/foundation\s*stage\s*(\d+)/g, "foundationstage$1")
        .replace(/grade\s*(\d+)/g, "grade$1")
        .replace(/kg\s*(\d+)/g, "kg$1")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizedContains(haystack: string, needle: string): boolean {
    const normalizedNeedle = normalizeRoutingText(needle);
    if (!normalizedNeedle) return false;
    return ` ${haystack} `.includes(` ${normalizedNeedle} `);
}

function resolveMailboxRouting(
    mailbox: MailboxConfig,
    subject: string,
    body: string
): ResolvedRouting {
    const routes = mailbox.routes || [];

    if (routes.length === 0) {
        return {
            selectedRoute: null,
            schoolName: null,
            divisionName: null,
            gradeName: null,
            schools: [],
            divisions: [],
            allowedGrades: [],
        };
    }

    const schools = uniqueStrings(routes.map((route) => route.school));
    const divisions = uniqueStrings(routes.map((route) => route.division));
    const allowedGrades = uniqueStrings(
        routes.flatMap((route) => route.grades || [])
    );

    const haystack = normalizeRoutingText(`${subject} ${body}`);

    const matchedGrades = allowedGrades.filter((grade) =>
        normalizedContains(haystack, grade)
    );

    let selectedRoute: MailboxRoute | null =
        routes.length === 1 ? routes[0] : null;

    if (!selectedRoute && haystack) {
        const scored = routes
            .map((route) => {
                let score = 0;

                if (normalizedContains(haystack, route.school)) {
                    score += 4;
                }

                if (normalizedContains(haystack, route.division)) {
                    score += 2;
                }

                for (const grade of route.grades || []) {
                    if (normalizedContains(haystack, grade)) {
                        score += 5;
                    }
                }

                return { route, score };
            })
            .sort((a, b) => b.score - a.score);

        if (
            scored.length > 0 &&
            scored[0].score > 0 &&
            (scored.length === 1 || scored[0].score > scored[1].score)
        ) {
            selectedRoute = scored[0].route;
        }
    }

    return {
        selectedRoute,
        schoolName:
            selectedRoute?.school ||
            (schools.length === 1 ? schools[0] : null),
        divisionName:
            selectedRoute?.division ||
            (divisions.length === 1 ? divisions[0] : null),
        gradeName:
            matchedGrades.length === 1 ? matchedGrades[0] : null,
        schools,
        divisions,
        allowedGrades,
    };
}

function collectEmployeeValues(...values: any[]): string[] {
    const result: string[] = [];

    for (const value of values) {
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === "string" && item.trim()) {
                    result.push(item.trim());
                }
            }
        } else if (typeof value === "string" && value.trim()) {
            result.push(value.trim());
        }
    }

    return uniqueStrings(result);
}

function hasNormalizedOverlap(left: string[], right: string[]): boolean {
    const normalizedRight = new Set(
        right.map((value) => normalizeRoutingText(value))
    );

    return left.some((value) =>
        normalizedRight.has(normalizeRoutingText(value))
    );
}

function employeeMatchesMailbox(
    employee: any,
    mailbox: MailboxConfig,
    routing: ResolvedRouting
): boolean {
    if (employee.status === "Busy") return false;

    if (
        mailbox.campusId &&
        !(employee.campusIds || []).includes(mailbox.campusId)
    ) {
        return false;
    }

    // Optional queue-level restriction. If a user document already has one of
    // these fields, it will be respected. If not, routing remains backward compatible.
    const employeeMailboxEmails = collectEmployeeValues(
        employee.mailboxEmails,
        employee.queueEmails,
        employee.mailboxes
    );

    if (
        employeeMailboxEmails.length > 0 &&
        !employeeMailboxEmails.some(
            (email) => email.toLowerCase() === mailbox.email.toLowerCase()
        )
    ) {
        return false;
    }

    // Optional grade restriction.
    const employeeGrades = collectEmployeeValues(
        employee.grades,
        employee.gradeNames,
        employee.grade,
        employee.gradeName
    );

    const requiredGrades = routing.gradeName
        ? [routing.gradeName]
        : routing.allowedGrades;

    if (
        employeeGrades.length > 0 &&
        requiredGrades.length > 0 &&
        !hasNormalizedOverlap(employeeGrades, requiredGrades)
    ) {
        return false;
    }

    // Optional school / curriculum restriction.
    const employeeSchools = collectEmployeeValues(
        employee.schools,
        employee.schoolNames,
        employee.school,
        employee.schoolName,
        employee.curriculums,
        employee.curriculum
    );

    if (
        employeeSchools.length > 0 &&
        routing.schoolName &&
        !hasNormalizedOverlap(employeeSchools, [routing.schoolName])
    ) {
        return false;
    }

    // Optional division restriction.
    const employeeDivisions = collectEmployeeValues(
        employee.divisions,
        employee.divisionNames,
        employee.division,
        employee.divisionName
    );

    if (
        employeeDivisions.length > 0 &&
        routing.divisionName &&
        !hasNormalizedOverlap(employeeDivisions, [routing.divisionName])
    ) {
        return false;
    }

    return true;
}

async function extractEmailBody(
    gmail: any,
    messageId: string,
    payload: any
): Promise<string> {
    const decode = (data: string): string => {
        return Buffer.from(
            data.replace(/-/g, "+").replace(/_/g, "/"),
            "base64"
        ).toString("utf-8");
    };

    const htmlToText = (html: string): string => {
        return html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<\/div>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    };

    async function getPartBody(part: any): Promise<string> {
        if (!part) return "";

        if (part.body?.data) {
            return decode(part.body.data);
        }

        if (part.body?.attachmentId) {
            const response = await gmail.users.messages.attachments.get({
                userId: "me",
                messageId,
                id: part.body.attachmentId,
            });

            if (response.data.data) {
                return decode(response.data.data);
            }
        }

        return "";
    }

    const plainParts: string[] = [];
    const htmlParts: string[] = [];

    async function walkParts(part: any): Promise<void> {
        if (!part) return;

        const isAttachment =
            Boolean(part.filename) ||
            part.headers?.some(
                (header: any) =>
                    header.name?.toLowerCase() === "content-disposition" &&
                    header.value?.toLowerCase().includes("attachment")
            );

        if (part.mimeType === "text/plain" && !isAttachment) {
            const body = await getPartBody(part);
            if (body.trim()) plainParts.push(body.trim());
        }

        if (part.mimeType === "text/html" && !isAttachment) {
            const body = await getPartBody(part);
            if (body.trim()) {
                const converted = htmlToText(body);
                if (converted.trim()) htmlParts.push(converted);
            }
        }

        if (Array.isArray(part.parts)) {
            for (const child of part.parts) {
                await walkParts(child);
            }
        }
    }

    await walkParts(payload);

    const plainText = plainParts.join("\n\n").trim();
    const htmlText = htmlParts.join("\n\n").trim();

    console.log("EMAIL BODY EXTRACTION:", {
        messageId,
        mimeType: payload?.mimeType,
        plainParts: plainParts.length,
        htmlParts: htmlParts.length,
        plainLength: plainText.length,
        htmlLength: htmlText.length,
    });

    if (htmlText) return htmlText;
    if (plainText) return plainText;

    const directBody = await getPartBody(payload);

    if (directBody) {
        return payload?.mimeType === "text/html"
            ? htmlToText(directBody)
            : directBody.trim();
    }

    console.error(`EMAIL BODY EXTRACTION FAILED: ${messageId}`);
    return "";
}

async function extractAndUploadEmailAttachments(
    gmail: any,
    messageId: string,
    payload: any
): Promise<string[]> {
    const attachmentUrls: string[] = [];
    const bucket = getStorage().bucket();

    async function walkPart(part: any): Promise<void> {
        if (!part) return;

        if (part.filename) {
            try {
                let attachmentData: string | undefined;

                if (part.body?.data) {
                    attachmentData = part.body.data;
                }

                if (!attachmentData && part.body?.attachmentId) {
                    const attachmentResponse =
                        await gmail.users.messages.attachments.get({
                            userId: "me",
                            messageId,
                            id: part.body.attachmentId,
                        });

                    attachmentData =
                        attachmentResponse.data.data || undefined;
                }

                if (attachmentData) {
                    const normalizedData = attachmentData
                        .replace(/-/g, "+")
                        .replace(/_/g, "/");

                    const buffer = Buffer.from(normalizedData, "base64");

                    const originalName =
                        part.filename || `attachment-${Date.now()}`;

                    const safeName = originalName.replace(
                        /[^a-zA-Z0-9._-]/g,
                        "_"
                    );

                    const filePath =
                        `attachments/email/${messageId}/` +
                        `${Date.now()}_${randomUUID()}_${safeName}`;

                    const token = randomUUID();
                    const file = bucket.file(filePath);

                    await file.save(buffer, {
                        resumable: false,
                        contentType:
                            part.mimeType || "application/octet-stream",
                        metadata: {
                            metadata: {
                                firebaseStorageDownloadTokens: token,
                            },
                        },
                    });

                    const downloadUrl =
                        "https://firebasestorage.googleapis.com/v0/b/" +
                        `${bucket.name}/o/${encodeURIComponent(filePath)}` +
                        `?alt=media&token=${token}`;

                    attachmentUrls.push(downloadUrl);

                    console.log(
                        `Email attachment uploaded: ${originalName}`
                    );
                }
            } catch (attachmentError) {
                console.error(
                    `Failed to process attachment ${part.filename}:`,
                    attachmentError
                );
            }
        }

        if (Array.isArray(part.parts)) {
            for (const childPart of part.parts) {
                await walkPart(childPart);
            }
        }
    }

    await walkPart(payload);
    return attachmentUrls;
}

async function acquireMessageLock(
    processedRef: admin.firestore.DocumentReference,
    mailboxEmail: string,
    messageId: string
): Promise<boolean> {
    const existing = await processedRef.get();

    if (existing.exists) {
        const data = existing.data() as any;

        const isFailed = data?.status === "failed";

        const startedAtMillis =
            typeof data?.startedAt?.toMillis === "function"
                ? data.startedAt.toMillis()
                : null;

        const isStaleProcessing =
            data?.status === "processing" &&
            startedAtMillis !== null &&
            Date.now() - startedAtMillis > 10 * 60 * 1000;

        if (!isFailed && !isStaleProcessing) {
            return false;
        }

        await processedRef.set(
            {
                status: "processing",
                mailbox: mailboxEmail,
                messageId,
                startedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastError: admin.firestore.FieldValue.delete(),
            },
            { merge: true }
        );

        return true;
    }

    try {
        await processedRef.create({
            status: "processing",
            mailbox: mailboxEmail,
            messageId,
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return true;
    } catch (error: any) {
        if (
            error?.code === 6 ||
            error?.code === "already-exists" ||
            error?.code === "ALREADY_EXISTS"
        ) {
            return false;
        }

        throw error;
    }
}

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    let cursor = 0;

    async function runner(): Promise<void> {
        while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            await worker(items[index]);
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(limit, items.length) },
            () => runner()
        )
    );
}

export const syncEmails = onSchedule(
    {
        schedule: "every 2 minutes",
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    async () => {
        try {
            const keyString = GMAIL_SERVICE_ACCOUNT_KEY.value();

            if (!keyString) {
                throw new Error("Missing GMAIL_SERVICE_ACCOUNT_KEY secret.");
            }

            const key = JSON.parse(keyString);
            const db = admin.firestore();

            const deptsSnapshot = await db.collection("departments").get();

            const allDepts = deptsSnapshot.docs.map((doc) => ({
                id: doc.id,
                ...(doc.data() as any),
            }));

            const enabledMailboxes = MAILBOXES.filter(
                (item) => item.enabled !== false
            );

            await runWithConcurrency(
                enabledMailboxes,
                6,
                async (mailbox) => {
                    try {
                        console.log(`START MAILBOX: ${mailbox.email}`);

                        const gmail = await createGmailClient(
                            key,
                            mailbox.email,
                            [
                                "https://www.googleapis.com/auth/gmail.readonly",
                                "https://www.googleapis.com/auth/gmail.modify",
                                "https://www.googleapis.com/auth/gmail.send",
                            ]
                        );

                        const listRes = await gmail.users.messages.list({
                            userId: "me",
                            q: "in:inbox newer_than:7d",
                            maxResults: 25,
                        });

                        const messages = listRes.data.messages || [];

                        console.log(
                            `SUCCESS MAILBOX: ${mailbox.email} - ${messages.length} messages`
                        );

                        for (const msg of messages) {
                            if (!msg.id) continue;

                            const safeMailbox = mailbox.email
                                .toLowerCase()
                                .replace(/[^a-z0-9]/g, "_");

                            const processedRef = db
                                .collection("processed_emails")
                                .doc(`${safeMailbox}_${msg.id}`);

                            const ticketDocId =
                                `${safeMailbox}_${msg.id}`;

                            const ticketRef = db
                                .collection("tickets")
                                .doc(ticketDocId);

                            let locked = false;

                            try {
                                locked = await acquireMessageLock(
                                    processedRef,
                                    mailbox.email,
                                    msg.id
                                );

                                if (!locked) {
                                    console.log(
                                        `SKIPPING DUPLICATE MESSAGE: ${msg.id} from ${mailbox.email}`
                                    );
                                    continue;
                                }

                                console.log(
                                    `PROCESSING MESSAGE: ${msg.id} from ${mailbox.email}`
                                );

                                const msgData =
                                    await gmail.users.messages.get({
                                        userId: "me",
                                        id: msg.id,
                                        format: "full",
                                    });

                                const headers =
                                    msgData.data.payload?.headers || [];

                                const emailAttachments =
                                    await extractAndUploadEmailAttachments(
                                        gmail,
                                        msg.id,
                                        msgData.data.payload
                                    );

                                let fullBodyText = (
                                    await extractEmailBody(
                                        gmail,
                                        msg.id,
                                        msgData.data.payload
                                    )
                                ).trim();

                                if (!fullBodyText) {
                                    console.error(
                                        `FULL BODY EXTRACTION FAILED: ${msg.id}`,
                                        {
                                            snippet: msgData.data.snippet,
                                            mimeType:
                                                msgData.data.payload?.mimeType,
                                        }
                                    );

                                    fullBodyText = msgData.data.snippet
                                        ? `[Email body could not be fully extracted]\n\n${msgData.data.snippet}`
                                        : "";
                                }

                                if (
                                    !fullBodyText &&
                                    emailAttachments.length === 0
                                ) {
                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            skipped: true,
                                            reason: "empty",
                                            mailbox: mailbox.email,
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    continue;
                                }

                                if (
                                    !fullBodyText &&
                                    emailAttachments.length > 0
                                ) {
                                    fullBodyText = "Attachment received";
                                }

                                const subject =
                                    headers.find(
                                        (header: any) =>
                                            header.name?.toLowerCase() ===
                                            "subject"
                                    )?.value || "No subject";

                                const fromHeader =
                                    headers.find(
                                        (header: any) =>
                                            header.name?.toLowerCase() ===
                                            "from"
                                    )?.value || "Unknown";

                                const messageIdHeader =
                                    normalizeMessageId(
                                        headers.find(
                                            (header: any) =>
                                                header.name?.toLowerCase() ===
                                                "message-id"
                                        )?.value
                                    );

                                const inReplyTo =
                                    normalizeMessageId(
                                        headers.find(
                                            (header: any) =>
                                                header.name?.toLowerCase() ===
                                                "in-reply-to"
                                        )?.value
                                    );

                                const references =
                                    parseReferences(
                                        headers.find(
                                            (header: any) =>
                                                header.name?.toLowerCase() ===
                                                "references"
                                        )?.value
                                    );

                                const emailMatch =
                                    fromHeader.match(/<(.*?)>/);

                                const senderEmail = (
                                    emailMatch
                                        ? emailMatch[1]
                                        : fromHeader
                                ).trim();

                                const senderName =
                                    fromHeader
                                        .replace(/<.*?>/, "")
                                        .replace(/"/g, "")
                                        .trim() || senderEmail;

                                if (
                                    senderEmail.toLowerCase() ===
                                    mailbox.email.toLowerCase()
                                ) {
                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            skipped: true,
                                            reason: "self-email",
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    continue;
                                }

                                let existingTicketDoc:
                                    | admin.firestore.QueryDocumentSnapshot
                                    | null = null;

                                const candidateIds = [
                                    inReplyTo,
                                    ...references,
                                ].filter(
                                    (item): item is string =>
                                        Boolean(item)
                                );

                                for (const candidateId of candidateIds) {
                                    const existingTicket =
                                        await db
                                            .collection("tickets")
                                            .where(
                                                "emailMessageIds",
                                                "array-contains",
                                                candidateId
                                            )
                                            .limit(1)
                                            .get();

                                    if (!existingTicket.empty) {
                                        const doc =
                                            existingTicket.docs[0];

                                        const ticketData =
                                            doc.data() as any;

                                        if (
                                            !["Resolved", "Closed"].includes(
                                                ticketData.status
                                            )
                                        ) {
                                            existingTicketDoc = doc;
                                        }

                                        break;
                                    }
                                }

                                const targetDept =
                                    allDepts.find(
                                        (department) =>
                                            department.name
                                                ?.trim()
                                                .toLowerCase() ===
                                            mailbox.department
                                                .trim()
                                                .toLowerCase()
                                    );

                                if (!targetDept) {
                                    console.error(
                                        `Department "${mailbox.department}" not found for mailbox ${mailbox.email}`
                                    );

                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            skipped: true,
                                            reason:
                                                "department-not-found",
                                            mailbox: mailbox.email,
                                            department:
                                                mailbox.department,
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    continue;
                                }

                                const now = new Date();

                                const creatorUserId =
                                    `email_${senderEmail.replace(
                                        /[^a-zA-Z0-9]/g,
                                        "_"
                                    )}`;

                                if (existingTicketDoc) {
                                    const replyUpdate: any = {
                                        updatedAt:
                                            admin.firestore.FieldValue.serverTimestamp(),

                                        status:
                                            (existingTicketDoc.data() as any)
                                                .status === "Queue"
                                                ? "Queue"
                                                : "Open",

                                        emailMessageIds:
                                            admin.firestore.FieldValue.arrayUnion(
                                                ...(messageIdHeader
                                                    ? [messageIdHeader]
                                                    : [])
                                            ),

                                        messages:
                                            admin.firestore.FieldValue.arrayUnion(
                                                {
                                                    id: String(
                                                        generateRandom4Digit()
                                                    ),
                                                    author: {
                                                        userId:
                                                            creatorUserId,
                                                        name: senderName,
                                                        email: senderEmail,
                                                        avatarUrl: "",
                                                    },
                                                    text: fullBodyText,
                                                    createdAt:
                                                        now.toISOString(),
                                                    source: "email",
                                                    attachments:
                                                        emailAttachments,
                                                }
                                            ),
                                    };

                                    if (emailAttachments.length > 0) {
                                        replyUpdate.attachments =
                                            admin.firestore.FieldValue.arrayUnion(
                                                ...emailAttachments
                                            );
                                    }

                                    await existingTicketDoc.ref.update(
                                        replyUpdate
                                    );

                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            type: "reply",
                                            ticketId:
                                                existingTicketDoc.id,
                                            mailbox: mailbox.email,
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    await gmail.users.messages.modify({
                                        userId: "me",
                                        id: msg.id,
                                        requestBody: {
                                            removeLabelIds: ["UNREAD"],
                                        },
                                    });

                                    console.log(
                                        `Reply added to ticket ${existingTicketDoc.id} from ${mailbox.email}`
                                    );

                                    continue;
                                }

                                const routing =
                                    resolveMailboxRouting(
                                        mailbox,
                                        subject,
                                        fullBodyText
                                    );

                                let assignedTo: any = null;
                                let status: "Queue" | "Open" = "Queue";

                                if (
                                    isWorkingTime(
                                        targetDept.workingHours
                                    )
                                ) {
                                    const deptRef = db
                                        .collection("departments")
                                        .doc(targetDept.id);

                                    await db.runTransaction(
                                        async (transaction) => {
                                            const empSnapshot =
                                                await transaction.get(
                                                    db
                                                        .collection("users")
                                                        .where(
                                                            "departmentId",
                                                            "==",
                                                            targetDept.id
                                                        )
                                                        .where(
                                                            "role",
                                                            "==",
                                                            "Employee"
                                                        )
                                                );

                                            const available =
                                                empSnapshot.docs
                                                    .map((doc) => ({
                                                        id: doc.id,
                                                        ...(doc.data() as any),
                                                    }))
                                                    .filter((employee) =>
                                                        employeeMatchesMailbox(
                                                            employee,
                                                            mailbox,
                                                            routing
                                                        )
                                                    )
                                                    .sort((a, b) =>
                                                        a.id.localeCompare(
                                                            b.id
                                                        )
                                                    );

                                            if (available.length > 0) {
                                                const deptSnapshot =
                                                    await transaction.get(
                                                        deptRef
                                                    );

                                                const deptData =
                                                    deptSnapshot.data() ||
                                                    {};

                                                const assignmentKey =
                                                    mailbox.department ===
                                                    "Academic"
                                                        ? `${
                                                              mailbox.campusId ||
                                                              "all"
                                                          }_${safeMailbox}`
                                                        : mailbox.campusId ||
                                                          "all";

                                                const lastIdx =
                                                    (
                                                        deptData.lastAssignedUserIndexes ||
                                                        {}
                                                    )[assignmentKey] ?? -1;

                                                const nextIdx =
                                                    (lastIdx + 1) %
                                                    available.length;

                                                assignedTo =
                                                    available[nextIdx];

                                                status = "Open";

                                                transaction.update(
                                                    deptRef,
                                                    {
                                                        [`lastAssignedUserIndexes.${assignmentKey}`]:
                                                            nextIdx,
                                                    }
                                                );
                                            }
                                        }
                                    );
                                }

                                const ticketNumber =
                                    generateRandom4Digit();

                                console.log(
                                    "ABOUT TO CREATE TICKET",
                                    {
                                        mailbox: mailbox.email,
                                        senderEmail,
                                        subject,
                                        department:
                                            targetDept.name,
                                        campus:
                                            mailbox.campusName,
                                        division:
                                            routing.divisionName,
                                        school:
                                            routing.schoolName,
                                        grade:
                                            routing.gradeName,
                                        attachmentsCount:
                                            emailAttachments.length,
                                    }
                                );

                                const existingTicketRef =
                                    await ticketRef.get();

                                if (existingTicketRef.exists) {
                                    await processedRef.set(
                                        {
                                            status: "completed",
                                            type: "new",
                                            ticketId: ticketRef.id,
                                            mailbox: mailbox.email,
                                            processedAt:
                                                admin.firestore.FieldValue.serverTimestamp(),
                                        },
                                        { merge: true }
                                    );

                                    await gmail.users.messages.modify({
                                        userId: "me",
                                        id: msg.id,
                                        requestBody: {
                                            removeLabelIds: ["UNREAD"],
                                        },
                                    });

                                    console.log(
                                        `Existing deterministic ticket ${ticketRef.id} reused for message ${msg.id}`
                                    );

                                    continue;
                                }

                                await ticketRef.create({
                                    ticketNumber,

                                    subject,
                                    description: fullBodyText,

                                    status,
                                    priority: "Normal",

                                    departmentId: targetDept.id,
                                    departmentName: targetDept.name,

                                    // Kept for systems that call this field "category".
                                    categoryId: targetDept.id,
                                    categoryName: targetDept.name,

                                    campusId:
                                        mailbox.campusId || null,
                                    campusName:
                                        mailbox.campusName || null,

                                    division:
                                        routing.divisionName,
                                    divisionName:
                                        routing.divisionName,
                                    divisionNames:
                                        routing.divisions,

                                    school:
                                        routing.schoolName,
                                    schoolName:
                                        routing.schoolName || "N/A",
                                    schoolNames:
                                        routing.schools,

                                    grade:
                                        routing.gradeName,
                                    gradeName:
                                        routing.gradeName,
                                    grades:
                                        routing.allowedGrades,
                                    allowedGrades:
                                        routing.allowedGrades,

                                    routingOptions:
                                        mailbox.routes || [],

                                    parentName: senderName,
                                    parentEmail: senderEmail,

                                    createdBy: {
                                        userId: creatorUserId,
                                        name: senderName,
                                        email: senderEmail,
                                        avatarUrl: "",
                                    },

                                    assignedTo: assignedTo
                                        ? {
                                              userId:
                                                  assignedTo.id,
                                              name:
                                                  assignedTo.name,
                                              email:
                                                  assignedTo.email ||
                                                  "",
                                              avatarUrl:
                                                  assignedTo.avatarUrl ||
                                                  "",
                                          }
                                        : null,

                                    source: "email",

                                    gmailMessageId: msg.id,

                                    emailMessageIds:
                                        messageIdHeader
                                            ? [messageIdHeader]
                                            : [],

                                    mailboxEmail:
                                        mailbox.email,
                                    originalRecipientEmail:
                                        mailbox.email,

                                    attachments:
                                        emailAttachments,

                                    createdAt:
                                        admin.firestore.FieldValue.serverTimestamp(),

                                    updatedAt:
                                        admin.firestore.FieldValue.serverTimestamp(),

                                    messages: [
                                        {
                                            id: String(
                                                generateRandom4Digit()
                                            ),

                                            author: {
                                                userId:
                                                    creatorUserId,
                                                name: senderName,
                                                email: senderEmail,
                                                avatarUrl: "",
                                            },

                                            text: fullBodyText,
                                            createdAt:
                                                now.toISOString(),
                                            source: "email",
                                            attachments:
                                                emailAttachments,
                                        },
                                    ],
                                });

                                await processedRef.set(
                                    {
                                        status: "completed",
                                        type: "new",
                                        ticketId:
                                            ticketRef.id,
                                        mailbox:
                                            mailbox.email,
                                        processedAt:
                                            admin.firestore.FieldValue.serverTimestamp(),
                                    },
                                    { merge: true }
                                );

                                await gmail.users.messages.modify({
                                    userId: "me",
                                    id: msg.id,
                                    requestBody: {
                                        removeLabelIds: ["UNREAD"],
                                    },
                                });

                                console.log(
                                    `New ticket #${ticketNumber} created from ${mailbox.email}`
                                );
                            } catch (messageError: any) {
                                console.error(
                                    `MESSAGE ERROR [${mailbox.email}] [${msg.id}]:`,
                                    messageError
                                );

                                if (locked) {
                                    try {
                                        await processedRef.set(
                                            {
                                                status: "failed",
                                                lastError:
                                                    String(
                                                        messageError?.message ||
                                                            messageError
                                                    ).slice(0, 1500),
                                                failedAt:
                                                    admin.firestore.FieldValue.serverTimestamp(),
                                            },
                                            { merge: true }
                                        );
                                    } catch (lockError) {
                                        console.error(
                                            "Failed to save processing error:",
                                            lockError
                                        );
                                    }
                                }
                            }
                        }
                    } catch (mailboxError) {
                        console.error(
                            `MAILBOX FAILED: ${mailbox.email}`,
                            mailboxError
                        );
                    }
                }
            );
        } catch (error) {
            console.error("Global Error:", error);
        }
    }
);

export const sendAfterHoursAutoReply = onDocumentCreated(
    {
        document: "tickets/{ticketId}",
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        try {
            const ticket = event.data?.data() as any;

            if (!ticket) return;

            const db = admin.firestore();

            if (!ticket.departmentId) {
                console.log(
                    `Ticket #${ticket.ticketNumber} has no departmentId; after-hours email skipped.`
                );
                return;
            }

            const deptSnap = await db
                .collection("departments")
                .doc(ticket.departmentId)
                .get();

            const dept = deptSnap.data() as any;

            if (isWorkingTime(dept?.workingHours)) {
                return;
            }

            const globalSnap = await db
                .collection("settings")
                .doc("afterHoursTicketEmail")
                .get();

            const globalSettings = globalSnap.data() as any;
            const settings =
                dept?.afterHoursEmail || globalSettings;

            if (!settings || settings.enabled === false) {
                console.log("After-hours email is disabled.");
                return;
            }

            const recipientEmail =
                ticket.parentEmail ||
                ticket.requesterEmail ||
                ticket.createdFor?.email ||
                ticket.createdBy?.email;

            if (!recipientEmail) {
                console.log(
                    `No recipient email found for ticket #${ticket.ticketNumber}`
                );
                return;
            }

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const senderEmail = getSenderMailbox(ticket);

            const bodyText = replacePlaceholders(
                settings.body || "",
                ticket,
                dept
            );

            const subjectText = replacePlaceholders(
                settings.subject ||
                    "We received your request",
                ticket,
                dept
            );

            const htmlBody =
                wrapInProfessionalTemplate(
                    "Automated Response",
                    "Outside Working Hours",
                    ticket.parentName ||
                        ticket.createdBy?.name ||
                        "User",
                    bodyText,
                    `${BASE_URL}/tickets/${event.params.ticketId}`,
                    String(ticket.ticketNumber),
                    ticket.subject || "Ticket"
                );

            await sendHtmlEmail({
                key,
                senderEmail,
                to: recipientEmail,
                subject: subjectText,
                html: htmlBody,
            });

            console.log(
                `After-hours email sent to ${recipientEmail} for ticket #${ticket.ticketNumber}`
            );
        } catch (error) {
            console.error("Auto-reply error:", error);
        }
    }
);

async function getAssigneeEmail(
    db: admin.firestore.Firestore,
    ticket: any
): Promise<string | null> {
    if (ticket?.assignedTo?.email) {
        return ticket.assignedTo.email;
    }

    const userId = ticket?.assignedTo?.userId;

    if (!userId) return null;

    const userSnap = await db
        .collection("users")
        .doc(userId)
        .get();

    if (!userSnap.exists) return null;

    const user = userSnap.data() as any;
    return user?.email || null;
}

export const sendEmailOnAgentReply = onDocumentUpdated(
    {
        document: "tickets/{ticketId}",
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        try {
            const after =
                event.data?.after.data() as any;

            const before =
                event.data?.before.data() as any;

            if (!after || !before) return;

            const afterMessages =
                after.messages || [];

            const beforeMessages =
                before.messages || [];

            if (
                afterMessages.length <=
                beforeMessages.length
            ) {
                return;
            }

            const lastMsg =
                afterMessages[
                    afterMessages.length - 1
                ];

            if (
                lastMsg.source === "email" ||
                lastMsg.isInternal
            ) {
                return;
            }

            const recipientEmail =
                after.parentEmail ||
                after.requesterEmail ||
                after.createdFor?.email ||
                after.createdBy?.email;

            if (!recipientEmail) {
                console.error(
                    `Ticket ${event.params.ticketId} has no requester email`
                );
                return;
            }

            const senderMailbox =
                getSenderMailbox(after);

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const previousIds =
                after.emailMessageIds || [];

            const newMessageId =
                `<ticket-${event.params.ticketId}-${Date.now()}@nis-crm.app>`;

            const htmlBody =
                wrapInProfessionalTemplate(
                    "Ticket Update",
                    "NIS CRM Support",
                    after.parentName ||
                        after.createdBy?.name ||
                        "User",
                    lastMsg.text ||
                        lastMsg.content ||
                        "",
                    `${BASE_URL}/tickets/${event.params.ticketId}`,
                    String(after.ticketNumber),
                    after.subject || "Ticket"
                );

            const extraHeaders: string[] = [
                `Message-ID: ${newMessageId}`,
            ];

            if (previousIds.length) {
                extraHeaders.push(
                    `In-Reply-To: <${
                        previousIds[
                            previousIds.length - 1
                        ]
                    }>`
                );

                extraHeaders.push(
                    `References: ${previousIds
                        .map(
                            (id: string) =>
                                `<${id}>`
                        )
                        .join(" ")}`
                );
            }

            await sendHtmlEmail({
                key,
                senderEmail: senderMailbox,
                to: recipientEmail,
                subject:
                    `Re: [Ticket #${after.ticketNumber}] ${after.subject}`,
                html: htmlBody,
                fromName: "Support Team",
                extraHeaders,
            });

            await event.data?.after.ref.update({
                emailMessageIds:
                    admin.firestore.FieldValue.arrayUnion(
                        newMessageId.replace(
                            /^<|>$/g,
                            ""
                        )
                    ),
            });

            console.log(
                `Parent email sent successfully to ${recipientEmail} for ticket #${after.ticketNumber}`
            );
        } catch (error) {
            console.error("Reply Error:", error);
        }
    }
);

export const sendEmailOnAssignment = onDocumentUpdated(
    {
        document: "tickets/{ticketId}",
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        try {
            const after =
                event.data?.after.data() as any;

            const before =
                event.data?.before.data() as any;

            if (!after?.assignedTo?.userId) return;

            const beforeAssigneeId =
                before?.assignedTo?.userId;

            const afterAssigneeId =
                after.assignedTo.userId;

            if (
                beforeAssigneeId ===
                afterAssigneeId
            ) {
                return;
            }

            const db = admin.firestore();

            const employeeEmail =
                await getAssigneeEmail(
                    db,
                    after
                );

            if (!employeeEmail) {
                console.log(
                    `No employee email found for ticket #${after.ticketNumber}`
                );
                return;
            }

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const senderEmail =
                getSenderMailbox(after);

            const content =
                "A ticket has been assigned to you for review.\n\n" +
                `Ticket Number: #${after.ticketNumber}\n` +
                `Subject: ${after.subject}\n` +
                `Campus: ${after.campusName || "N/A"}\n` +
                `Division: ${after.divisionName || after.division || "N/A"}\n` +
                `School: ${after.schoolName || after.school || "N/A"}\n` +
                `Grade: ${after.gradeName || after.grade || "N/A"}\n` +
                `Parent: ${after.parentName || "N/A"}\n\n` +
                "Please log in to the portal to view the full details and respond.";

            const htmlBody =
                wrapInProfessionalTemplate(
                    "Ticket Assigned to You",
                    "NIS CRM Notification",
                    after.assignedTo.name ||
                        "Staff Member",
                    content,
                    `${BASE_URL}/tickets/${event.params.ticketId}`,
                    String(after.ticketNumber),
                    after.subject || "Ticket"
                );

            await sendHtmlEmail({
                key,
                senderEmail,
                to: employeeEmail,
                subject:
                    `New Ticket Assigned: #${after.ticketNumber}`,
                html: htmlBody,
            });

            console.log(
                `Assignment email sent to ${employeeEmail}`
            );
        } catch (error) {
            console.error(
                "Assignment notification error:",
                error
            );
        }
    }
);

export const sendEmailOnNewTicketAssignment = onDocumentCreated(
    {
        document: "tickets/{ticketId}",
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        try {
            const ticket =
                event.data?.data() as any;

            if (
                !ticket?.assignedTo?.userId
            ) {
                return;
            }

            const db = admin.firestore();

            const employeeEmail =
                await getAssigneeEmail(
                    db,
                    ticket
                );

            if (!employeeEmail) {
                console.log(
                    `No employee email found for ticket #${ticket.ticketNumber}`
                );
                return;
            }

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const senderEmail =
                getSenderMailbox(ticket);

            const content =
                "A new ticket was created and assigned to you.\n\n" +
                `Ticket Number: #${ticket.ticketNumber}\n` +
                `Subject: ${ticket.subject}\n` +
                `Campus: ${ticket.campusName || "N/A"}\n` +
                `Division: ${ticket.divisionName || ticket.division || "N/A"}\n` +
                `School: ${ticket.schoolName || ticket.school || "N/A"}\n` +
                `Grade: ${ticket.gradeName || ticket.grade || "N/A"}\n` +
                `Parent: ${ticket.parentName || "N/A"}\n\n` +
                "Please log in to the portal to review the ticket.";

            const htmlBody =
                wrapInProfessionalTemplate(
                    "New Ticket Assignment",
                    "NIS CRM Notification",
                    ticket.assignedTo.name ||
                        "Staff Member",
                    content,
                    `${BASE_URL}/tickets/${event.params.ticketId}`,
                    String(ticket.ticketNumber),
                    ticket.subject || "Ticket"
                );

            await sendHtmlEmail({
                key,
                senderEmail,
                to: employeeEmail,
                subject:
                    `New Ticket Assigned: #${ticket.ticketNumber}`,
                html: htmlBody,
            });

            console.log(
                `New ticket email sent to ${employeeEmail}`
            );
        } catch (error) {
            console.error(
                "New ticket assignment notification error:",
                error
            );
        }
    }
);

function getTransferIdentity(ticket: any): {
    id: string | null;
    name: string;
} {
    return {
        id:
            ticket?.categoryId ||
            ticket?.departmentId ||
            null,
        name:
            ticket?.categoryName ||
            ticket?.departmentName ||
            "Unknown Category",
    };
}

async function getTransferStaffRecipients(
    db: admin.firestore.Firestore,
    before: any,
    after: any
): Promise<string[]> {
    const snapshot = await db
        .collection("users")
        .where(
            "role",
            "in",
            ["Manager", "Admin", "manager", "admin"]
        )
        .get();

    const oldIdentity =
        getTransferIdentity(before);

    const newIdentity =
        getTransferIdentity(after);

    const ticketCampusId =
        after.campusId || before.campusId;

    const emails: string[] = [];

    for (const doc of snapshot.docs) {
        const user = doc.data() as any;
        const role = String(
            user.role || ""
        ).toLowerCase();

        if (!user.email) continue;

        if (role === "admin") {
            emails.push(user.email);
            continue;
        }

        if (role !== "manager") continue;

        const managerDepartmentIds =
            collectEmployeeValues(
                user.departmentId,
                user.departmentIds,
                user.categoryId,
                user.categoryIds
            );

        const managerCampusIds =
            collectEmployeeValues(
                user.campusId,
                user.campusIds
            );

        const hasDepartmentRestriction =
            managerDepartmentIds.length > 0;

        const hasCampusRestriction =
            managerCampusIds.length > 0;

        const matchesDepartment =
            !hasDepartmentRestriction ||
            managerDepartmentIds.includes(
                oldIdentity.id || ""
            ) ||
            managerDepartmentIds.includes(
                newIdentity.id || ""
            );

        const matchesCampus =
            !hasCampusRestriction ||
            !ticketCampusId ||
            managerCampusIds.includes(
                ticketCampusId
            );

        if (
            matchesDepartment &&
            matchesCampus
        ) {
            emails.push(user.email);
        }
    }

    return uniqueStrings(emails);
}

export const sendEmailToParentOnTransfer = onDocumentUpdated(
    {
        document: "tickets/{ticketId}",
        secrets: [GMAIL_SERVICE_ACCOUNT_KEY],
        timeoutSeconds: 120,
        memory: "256MiB",
    },
    async (event) => {
        try {
            const after =
                event.data?.after.data() as any;

            const before =
                event.data?.before.data() as any;

            if (!after || !before) return;

            const oldIdentity =
                getTransferIdentity(before);

            const newIdentity =
                getTransferIdentity(after);

            if (
                oldIdentity.id ===
                newIdentity.id
            ) {
                return;
            }

            const db = admin.firestore();

            const key = JSON.parse(
                GMAIL_SERVICE_ACCOUNT_KEY.value()
            );

            const senderEmail =
                getSenderMailbox(after);

            const parentEmail =
                after.parentEmail ||
                after.requesterEmail ||
                after.createdFor?.email ||
                after.createdBy?.email;

            if (parentEmail) {
                const parentContent =
                    "Your ticket has been transferred to a different category.\n\n" +
                    `Ticket Number: #${after.ticketNumber}\n` +
                    `Subject: ${after.subject}\n` +
                    `Previous Category: ${oldIdentity.name}\n` +
                    `New Category: ${newIdentity.name}\n\n` +
                    "Your request will now be handled by the appropriate team.";

                const parentHtml =
                    wrapInProfessionalTemplate(
                        "Ticket Category Updated",
                        "NIS CRM Support",
                        after.parentName ||
                            after.createdBy?.name ||
                            "User",
                        parentContent,
                        `${BASE_URL}/tickets/${event.params.ticketId}`,
                        String(after.ticketNumber),
                        after.subject || "Ticket"
                    );

                await sendHtmlEmail({
                    key,
                    senderEmail,
                    to: parentEmail,
                    subject:
                        `Ticket #${after.ticketNumber} Category Updated`,
                    html: parentHtml,
                });

                console.log(
                    `Transfer email sent to user ${parentEmail}`
                );
            }

            const staffRecipients =
                await getTransferStaffRecipients(
                    db,
                    before,
                    after
                );

            for (const staffEmail of staffRecipients) {
                try {
                    const staffContent =
                        "A ticket has been transferred to a different category.\n\n" +
                        `Ticket Number: #${after.ticketNumber}\n` +
                        `Subject: ${after.subject}\n` +
                        `Previous Category: ${oldIdentity.name}\n` +
                        `New Category: ${newIdentity.name}\n` +
                        `Campus: ${after.campusName || "N/A"}\n` +
                        `Parent: ${after.parentName || "N/A"}\n\n` +
                        "Please review the ticket if any action is required.";

                    const staffHtml =
                        wrapInProfessionalTemplate(
                            "Ticket Category Transfer",
                            "NIS CRM Notification",
                            "Manager / Admin",
                            staffContent,
                            `${BASE_URL}/tickets/${event.params.ticketId}`,
                            String(after.ticketNumber),
                            after.subject || "Ticket"
                        );

                    await sendHtmlEmail({
                        key,
                        senderEmail,
                        to: staffEmail,
                        subject:
                            `Ticket #${after.ticketNumber} Transferred: ${oldIdentity.name} to ${newIdentity.name}`,
                        html: staffHtml,
                    });

                    console.log(
                        `Transfer notification sent to ${staffEmail}`
                    );
                } catch (staffError) {
                    console.error(
                        `Failed to notify ${staffEmail} about transfer:`,
                        staffError
                    );
                }
            }
        } catch (error) {
            console.error(
                "Category transfer notification error:",
                error
            );
        }
    }
);
