import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function PrivacyPolicy() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
                Privacy Policy
            </button>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-bold">Privacy Policy</DialogTitle>
                    </DialogHeader>
                    
                    <div className="space-y-6 text-sm leading-relaxed">
                        <div>
                            <p className="font-semibold">Effective Date: 1/19/2020</p>
                            <p className="font-semibold">Last Updated: 2/1/2026</p>
                        </div>

                        <p>
                            Modal Education ("Modal Education," "Company," "we," "us," or "our") provides educational technology services designed for use by educators and schools. This Privacy Policy describes how information is collected, used, and safeguarded in connection with our website, applications, and related services (collectively, the "Services").
                        </p>

                        <p>
                            This Policy is intended to provide transparency to educators, schools, and districts evaluating the Services.
                        </p>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">1. Core Design Principle: No Personally Identifiable Student Information</h2>
                            <p className="mb-3">
                                Modal Education is intentionally designed to operate without collecting personally identifiable student information.
                            </p>
                            <p className="mb-2">The Services do not require students to provide:</p>
                            <ul className="list-disc ml-6 space-y-1">
                                <li>Full legal names</li>
                                <li>Last names</li>
                                <li>Email addresses</li>
                                <li>Birthdates</li>
                                <li>Home addresses</li>
                                <li>Phone numbers</li>
                                <li>Social Security numbers</li>
                                <li>Government identification numbers</li>
                                <li>Demographic data</li>
                                <li>Disability documentation</li>
                                <li>IEP information</li>
                                <li>Behavioral or disciplinary records</li>
                            </ul>
                            <p className="mt-3">
                                Students access the Services through pseudonymous or non-identifying credentials created and managed by their teacher or school.
                            </p>
                            <p className="mt-3">
                                Modal Education does not independently verify student identities and does not have the ability to identify individual students.
                            </p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">2. Information We Collect</h2>
                            
                            <h3 className="font-semibold mb-2">A. Teacher and School Information</h3>
                            <p className="mb-2">We collect limited professional information necessary to provide and support the Services, including:</p>
                            <ul className="list-disc ml-6 space-y-1 mb-3">
                                <li>Teacher name</li>
                                <li>School or district affiliation</li>
                                <li>Professional email address</li>
                                <li>Account login credentials</li>
                                <li>Classroom group identifiers</li>
                            </ul>
                            <p className="mb-4">This information is used solely to provide, administer, and support the Services.</p>

                            <h3 className="font-semibold mb-2">B. Pseudonymous Student Usage Data</h3>
                            <p className="mb-2">The Services generate usage data associated with pseudonymous student identifiers created by educators or schools. Such usage data may include:</p>
                            <ul className="list-disc ml-6 space-y-1 mb-3">
                                <li>Lesson completion events</li>
                                <li>Quiz attempts</li>
                                <li>Sign-in timestamps</li>
                                <li>Aggregate activity metrics</li>
                            </ul>
                            <p className="mb-3">This data is not linked to personally identifiable student information.</p>
                            <p>Modal Education does not collect student email addresses and does not directly contact students.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">3. How We Use Information</h2>
                            <p className="mb-2">Teacher and school information is used to:</p>
                            <ul className="list-disc ml-6 space-y-1 mb-4">
                                <li>Provide access to the Services</li>
                                <li>Manage classroom groups</li>
                                <li>Provide customer support</li>
                                <li>Maintain and improve platform functionality</li>
                                <li>Ensure platform security</li>
                            </ul>

                            <p className="mb-2">Pseudonymous student usage data is used solely for:</p>
                            <ul className="list-disc ml-6 space-y-1 mb-3">
                                <li>Displaying classroom progress to the teacher</li>
                                <li>Generating aggregated reporting</li>
                                <li>Maintaining platform functionality</li>
                            </ul>

                            <p>Modal Education does not use student usage data for advertising, profiling, marketing, or data monetization.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">4. No Sale or Commercial Exploitation of Student Data</h2>
                            <p className="mb-2">Modal Education does not:</p>
                            <ul className="list-disc ml-6 space-y-1 mb-3">
                                <li>Sell student data</li>
                                <li>Rent student data</li>
                                <li>Share student data with data brokers</li>
                                <li>Use student data for targeted advertising</li>
                                <li>Display third-party advertisements within the student experience</li>
                            </ul>
                            <p>Because we do not collect personally identifiable student information, there is no student personal data available for commercial sale or marketing.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">5. Control of Student Identifiers</h2>
                            <p className="mb-3">Teachers and schools retain full control over student identifiers entered into the Services.</p>
                            <p className="mb-2">Teachers may:</p>
                            <ul className="list-disc ml-6 space-y-1 mb-3">
                                <li>Use pseudonyms</li>
                                <li>Use initials</li>
                                <li>Use school-generated student ID numbers</li>
                                <li>Omit student names entirely</li>
                            </ul>
                            <p className="mb-3">Modal Education does not require real student names and does not verify student identity.</p>
                            <p>Schools and educators are responsible for determining what identifiers are entered into the platform and for ensuring their use complies with applicable laws and district policies.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">6. Data Ownership</h2>
                            <p className="mb-3">All classroom data entered into the Services remains the property of the applicable school or educator.</p>
                            <p className="mb-3">Modal Education does not claim ownership of student data or classroom records.</p>
                            <p>Schools and educators retain full control over student identifiers and classroom information.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">7. FERPA and Student Privacy Laws</h2>
                            <p className="mb-3">Modal Education provides educational technology services to educators and schools.</p>
                            <p className="mb-3">Because the Services are designed to operate without collecting personally identifiable student information, Modal Education does not maintain education records as defined under the Family Educational Rights and Privacy Act (FERPA).</p>
                            <p className="mb-3">When a school or district enters into a written agreement with Modal Education, the parties may define specific responsibilities regarding student privacy laws.</p>
                            <p>Absent such an agreement, schools and educators remain responsible for ensuring their use of the Services complies with applicable federal, state, and local laws.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">8. COPPA Compliance</h2>
                            <p className="mb-3">The Services are intended for use in educational settings under the supervision of a teacher or school.</p>
                            <p className="mb-3">Modal Education does not knowingly collect personal information directly from children under the age of 13.</p>
                            <p>The platform does not require students to provide personal information to access educational content.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">9. Data Security</h2>
                            <p className="mb-2">Modal Education implements commercially reasonable administrative, technical, and physical safeguards designed to protect information within our control, including:</p>
                            <ul className="list-disc ml-6 space-y-1 mb-3">
                                <li>Encrypted data transmission</li>
                                <li>Secure authentication systems</li>
                                <li>Role-based access controls</li>
                                <li>Restricted internal access</li>
                            </ul>
                            <p>While we take reasonable measures to safeguard information, no system can guarantee absolute security.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">10. Data Retention</h2>
                            <p className="mb-3">Teacher account information is retained for the duration of the account relationship.</p>
                            <p className="mb-3">Pseudonymous student usage data may be retained for the purpose of providing classroom reporting and maintaining platform functionality.</p>
                            <p>Schools or educators may request deletion of classroom data at any time by contacting us.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">11. Data Breach Notification</h2>
                            <p>In the event of unauthorized access to systems under our control that materially affects customer data, Modal Education will notify affected educators or schools within a commercially reasonable timeframe and will cooperate in investigating and remediating the incident.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">12. Third-Party Service Providers</h2>
                            <p className="mb-3">Modal Education may use third-party service providers to host and operate the Services.</p>
                            <p className="mb-2">Such providers:</p>
                            <ul className="list-disc ml-6 space-y-1 mb-3">
                                <li>Are contractually obligated to protect information</li>
                                <li>May process data solely for providing services to Modal Education</li>
                                <li>May not use data for independent commercial purposes</li>
                            </ul>
                            <p>Modal Education does not permit third-party advertising networks or data brokers access to student usage data.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">13. Data Requests and Contact Information</h2>
                            <p className="mb-2">Schools and educators may request:</p>
                            <ul className="list-disc ml-6 space-y-1 mb-3">
                                <li>Access to teacher account information</li>
                                <li>Deletion of classroom data</li>
                                <li>Written confirmation of data handling practices</li>
                            </ul>
                            <p className="mb-3">All privacy-related inquiries must be directed to:</p>
                            <p className="mb-3 font-semibold">contact@modalmath.com</p>
                            <p>We will respond within a commercially reasonable timeframe.</p>
                        </div>

                        <hr className="border-gray-300" />

                        <div>
                            <h2 className="text-lg font-bold mb-3">14. Changes to This Policy</h2>
                            <p className="mb-3">We may update this Privacy Policy to reflect operational, legal, or regulatory changes. Updates will be posted on our website with an updated effective date.</p>
                            <p>Continued use of the Services after changes constitutes acceptance of the revised Policy.</p>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}