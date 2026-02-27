import React, { useState } from 'react';
import { Key, Copy, Check, Printer } from 'lucide-react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

const LOGO_URL = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png';
const BRAND_PURPLE = '#632a8c';
const PASSWORD = 'Math1234!';

function printLoginCard(student) {
    const name = `${student.firstName || ''} ${student.lastName || ''}`.trim();
    const email = (student.email || '').toLowerCase().trim();

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Login Card - ${name}</title>
  <style>
    @page {
      size: 3.5in 2in;
      margin: 0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 3.5in;
      height: 2in;
      font-family: Arial, sans-serif;
      background: #fff;
      display: flex;
      align-items: stretch;
    }
    .card {
      width: 3.5in;
      height: 2in;
      padding: 0.18in 0.22in;
      border: 1.5px solid #ddd;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 7px;
      border-bottom: 1.5px solid ${BRAND_PURPLE};
      padding-bottom: 5px;
      margin-bottom: 4px;
    }
    .logo { width: 26px; height: 26px; object-fit: contain; }
    .brand { color: ${BRAND_PURPLE}; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; }
    .title { font-size: 13px; font-weight: 800; color: #1a1a1a; margin-bottom: 2px; }
    .row { font-size: 10px; color: #333; line-height: 1.5; }
    .row span { font-weight: 700; color: #111; }
    .footer {
      margin-top: auto;
      font-size: 9px;
      color: #888;
      border-top: 1px solid #eee;
      padding-top: 4px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <img class="logo" src="${LOGO_URL}" alt="Modal Math"/>
      <div class="brand">Modal Math</div>
    </div>
    <div class="title">Student Login</div>
    <div class="row">Name: <span>${name}</span></div>
    <div class="row">Email: <span>${email}</span></div>
    <div class="row">Password: <span>${PASSWORD}</span></div>
    <div class="footer">Sign in at: modalmath.thinkific.com</div>
  </div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=400,height=260');
    win.document.write(html);
    win.document.close();
    win.onload = () => {
        win.focus();
        win.print();
        win.close();
    };
}

export default function StudentCredentialsPopover({ student }) {
    const [copied, setCopied] = useState(false);
    const email = (student.email || '').toLowerCase().trim();

    const handleCopy = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(email);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    onClick={e => e.stopPropagation()}
                    className="ml-1.5 text-slate-400 hover:text-[#632a8c] transition-colors focus:outline-none"
                    title="View credentials"
                >
                    <Key className="w-3.5 h-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-72 p-0 shadow-lg border border-slate-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-[#f9f4fc]">
                    <img src={LOGO_URL} alt="Modal Math" className="w-6 h-6 object-contain" />
                    <span className="text-sm font-semibold text-[#632a8c]">Student Credentials</span>
                </div>

                {/* Body */}
                <div className="px-4 py-3 space-y-3">
                    {/* Email row */}
                    <div>
                        <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Email</p>
                        <div className="flex items-center gap-2 bg-slate-50 rounded-md px-3 py-1.5 border border-slate-200">
                            <span className="text-sm text-slate-800 flex-1 truncate font-mono">{email}</span>
                            <button
                                onClick={handleCopy}
                                className="text-slate-400 hover:text-[#632a8c] transition-colors flex-shrink-0"
                                title="Copy email"
                            >
                                {copied
                                    ? <Check className="w-3.5 h-3.5 text-green-500" />
                                    : <Copy className="w-3.5 h-3.5" />
                                }
                            </button>
                        </div>
                    </div>

                    {/* Password row */}
                    <div>
                        <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Password</p>
                        <div className="bg-slate-50 rounded-md px-3 py-1.5 border border-slate-200">
                            <span className="text-sm text-slate-800 font-mono">{PASSWORD}</span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 pb-3">
                    <Button
                        size="sm"
                        className="w-full bg-[#632a8c] hover:bg-[#7b35ae] text-white gap-2"
                        onClick={(e) => {
                            e.stopPropagation();
                            printLoginCard(student);
                        }}
                    >
                        <Printer className="w-4 h-4" />
                        Print Login Card
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}