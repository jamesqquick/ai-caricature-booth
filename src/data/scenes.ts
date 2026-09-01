export type PublicScene = {
  id: string;
  name: string;
  description: string;
};

export type Scene = PublicScene & {
  prompt: string;
};

export function toPublicScene(scene: PublicScene): PublicScene {
  return {
    id: scene.id,
    name: scene.name,
    description: scene.description,
  };
}
