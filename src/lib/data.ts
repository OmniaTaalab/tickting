'use server';

import type { UserProfile } from './types';
import placeholderImages from './placeholder-images.json';

const avatarMap = new Map(placeholderImages.userAvatars.map(avatar => [avatar.id, avatar.src]));

// In a real app, user data would come from Firestore Auth and a 'users' collection.
// For this demo, we'll keep a static list but make the function async to mimic a real DB call.
const userBaseData: Omit<UserProfile, 'avatarUrl'>[] = [
  { id: 'user-1', name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin', departmentId: 'it', age: 28 },
  { id: 'user-2', name: 'Bob Williams', email: 'bob@example.com', role: 'Admin', departmentId: 'hr', age: 34 },
  { id: 'user-3', name: 'Charlie Brown', email: 'charlie@example.com', role: 'Employee', age: 22 },
  { id: 'user-4', name: 'Diana Miller', email: 'diana@example.com', role: 'Admin', departmentId: 'finance', age: 41 },
  { id: 'user-5', name: 'Ethan Davis', email: 'ethan@example.com', role: 'Employee', age: 29 },
  { id: 'user-6', name: 'Fiona Garcia', email: 'fiona@example.com', role: 'Admin', departmentId: 'website', age: 31 },
  { id: 'user-7', name: 'George Rodriguez', email: 'george@example.com', role: 'Admin', departmentId: 'data', age: 38 },
];

export const users: UserProfile[] = userBaseData.map(user => ({
  ...user,
  avatarUrl: avatarMap.get(user.id) || '',
}));


export const getUsers = async (): Promise<UserProfile[]> => {
  return Promise.resolve(users);
};

export const getUserById = async (id: string): Promise<UserProfile | undefined> => {
    return Promise.resolve(users.find(u => u.id === id));
}

export const getCurrentUser = async (): Promise<UserProfile> => {
  // For this demo, we'll assume the current user is an Admin
  return new Promise(resolve => setTimeout(() => resolve(users[0]), 100));
};
