export type PublicScene = {
  id: string;
  name: string;
  description: string;
};

export type Scene = PublicScene & {
  prompt: string;
};
