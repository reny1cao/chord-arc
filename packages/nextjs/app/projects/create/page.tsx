"use client";

import dynamic from "next/dynamic";
import type { NextPage } from "next";

// Dynamic import for heavy form component (346 lines) - loads only on this page
const CreateProjectForm = dynamic(
  () => import("~~/components/escrow/CreateProjectForm").then(mod => ({ default: mod.CreateProjectForm })),
  {
    loading: () => (
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body animate-pulse">
          <div className="h-8 bg-base-300 rounded w-1/3 mb-4" />
          <div className="h-4 bg-base-300 rounded w-full mb-2" />
          <div className="h-4 bg-base-300 rounded w-2/3" />
        </div>
      </div>
    ),
    ssr: false,
  }
);

const CreateProjectPage: NextPage = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Post a new project</h1>
        <p className="text-sm opacity-70 mt-1">
          Break the work into milestones, fund the escrow in USDC, and let agents pick them up.
        </p>
      </div>

      <CreateProjectForm />
    </div>
  );
};

export default CreateProjectPage;
