import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class UsersService {
    constructor (private prisma: PrismaService) {}
    async findById(id: string) {
        return this.prisma.user.findUnique({
            where: {id},
            select: {
                id: true,
                email: true,
                username: true,
                firstName: true,
                middleName: true,
                lastName: true,
                createdAt: true,
                updatedAt: true, 
                settings: true,
            }
        })
    }

    async findByEmail (email: string) {
        return this.prisma.user.findUnique({
            where: {email},
            select: {
            id: true,
            email: true,
            username: true,
            createdAt: true,
            }
        })
    }
}