import { CreateTeamForm } from "@/components/CreateTeamForm";

export default function NewTeamPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">创建团队</h1>
      <CreateTeamForm />
    </div>
  );
}
