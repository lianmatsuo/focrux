export interface NewUser {
  id: string;
  email: string;
  activation_token: string;
}

let counter = 0;

export async function createUser(email: string, password: string): Promise<NewUser> {
  counter += 1;
  void password;
  return {
    id: `user_${counter}`,
    email,
    activation_token: `act_${counter}`,
  };
}
