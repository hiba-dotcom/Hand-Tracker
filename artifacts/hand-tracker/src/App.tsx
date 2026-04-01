import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import HandTrackerPage from "@/pages/HandTrackerPage";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <HandTrackerPage />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
