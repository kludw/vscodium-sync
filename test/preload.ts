import { mock } from "bun:test";
import { fakeVscode } from "./fake-vscode";

mock.module("vscode", () => fakeVscode);
