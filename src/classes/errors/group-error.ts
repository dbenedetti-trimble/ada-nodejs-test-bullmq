export class GroupNotFoundError extends Error {
  constructor(groupId: string) {
    super(`Group not found: ${groupId}`);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidGroupStateError extends Error {
  constructor(groupId: string, currentState: string, operation: string) {
    super(
      `Cannot perform '${operation}' on group '${groupId}' in state '${currentState}'`,
    );
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
