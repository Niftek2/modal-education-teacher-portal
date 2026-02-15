import PrivacyPolicy from './components/PrivacyPolicy';

export default function Layout({ children, currentPageName }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-gray-100 text-purple-900 shadow-lg">
        <div className="flex items-center gap-3 px-6 py-4">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png" 
            alt="Modal Education Logo" 
            className="h-8 w-8 object-contain flex-shrink-0"
          />
          <h1 className="text-lg tracking-tight" style={{ fontFamily: 'Arial' }}>Modal Education</h1>
        </div>
      </header>

      {/* Page Content */}
      <main className="flex-grow">
        {children}
      </main>

      {/* Footer */}
      <footer className="py-4 px-6 text-center bg-gray-50 border-t border-gray-200">
        <div className="flex flex-col gap-2">
          <PrivacyPolicy />
          <p className="text-xs text-gray-500">© 2026 Modal Education. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}