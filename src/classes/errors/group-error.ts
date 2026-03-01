export class GroupNotFoundError extends Error {
  constructor(groupId: string) {
    super(`Group ${groupId} not found`);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidGroupStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
